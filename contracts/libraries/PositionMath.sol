// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";

/**
 * @title PositionMath
 * @notice Mathematical calculations for position PnL, funding, and liquidation
 * @dev All calculations use 18 decimal precision for accuracy
 */
library PositionMath {
    using DataTypes for uint8;

    error InvalidPositionSize();
    error InvalidLeverage();
    error InvalidPrice();
    error DivisionByZero();
    error OverflowRisk();
    error PositionSizeTooLarge();
    error FundingDeltaTooLarge();
    error FundingOverflow();
    /// @dev Raised when a `uint256` value would silently truncate to a smaller width.
    error CastOverflow();

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant MIN_MAINTENANCE_MARGIN_BPS = 100;
    uint256 private constant DEFAULT_MAINTENANCE_MARGIN_BPS = 500;
    uint256 public constant MAX_DYNAMIC_MAINTENANCE_BPS = 2000; // hard cap at 20%
    /// @dev Maintenance margin is additionally capped to this fraction of the
    ///      position's initial-margin requirement (size / leverage). Without
    ///      this, the fixed-plus-leverage bps curve below exceeds `1/leverage`
    ///      above ~16x, which made any high-leverage position instantly
    ///      liquidatable at entry (i.e. impossible to open). Capping at 50% of
    ///      the initial margin guarantees a fresh position at any leverage up to
    ///      `MAX_LEVERAGE_LIMIT` (100x) opens with a health factor of ~2.0,
    ///      matching the standard "maintenance = half of initial" perp model.
    uint256 private constant MAINTENANCE_TO_INITIAL_CAP_BPS = 5000;
    uint256 private constant NO_LIQUIDATION_PRICE = type(uint128).max;

    /// @notice SafeCast helpers. Use at every uint256 → uintN
    ///         boundary inside this library and its callers.
    function toUint128(uint256 v) internal pure returns (uint128) {
        if (v > type(uint128).max) revert CastOverflow();
        return uint128(v);
    }

    function toUint64(uint256 v) internal pure returns (uint64) {
        if (v > type(uint64).max) revert CastOverflow();
        return uint64(v);
    }

    function toUint16(uint256 v) internal pure returns (uint16) {
        if (v > type(uint16).max) revert CastOverflow();
        return uint16(v);
    }

    function calculateUnrealizedPnL(
        uint256 size,
        uint256 entryPrice,
        uint256 currentPrice,
        bool isLong
    ) internal pure returns (int256 pnl) {
        if (size == 0) return 0;
        if (entryPrice == 0) revert InvalidPrice();

        if (isLong) {
            if (currentPrice >= entryPrice) {
                pnl = int256((size * (currentPrice - entryPrice)) / entryPrice);
            } else {
                pnl = -int256((size * (entryPrice - currentPrice)) / entryPrice);
            }
        } else {
            if (currentPrice <= entryPrice) {
                pnl = int256((size * (entryPrice - currentPrice)) / entryPrice);
            } else {
                pnl = -int256((size * (currentPrice - entryPrice)) / entryPrice);
            }
        }
    }

    function calculateRealizedPnL(
        int256 unrealizedPnL,
        uint256 tradingFee,
        int256 fundingOwed
    ) internal pure returns (int256 realizedPnL) {
        realizedPnL = unrealizedPnL - int256(tradingFee) - fundingOwed;
    }

    function calculatePnLPercent(int256 pnl, uint256 collateral) internal pure returns (int256 pnlPercent) {
        if (collateral == 0) revert DivisionByZero();
        pnlPercent = (pnl * int256(PRECISION)) / int256(collateral);
    }

    function calculateInitialMargin(uint256 size, uint256 leverage) internal pure returns (uint256 margin) {
        if (leverage == 0) revert InvalidLeverage();
        margin = (size * PRECISION) / leverage;
    }

    function calculateMaintenanceMargin(
        uint256 size,
        uint256 maintenanceMarginBps
    ) internal pure returns (uint256 margin) {
        uint256 effectiveBps = maintenanceMarginBps < MIN_MAINTENANCE_MARGIN_BPS
            ? MIN_MAINTENANCE_MARGIN_BPS
            : maintenanceMarginBps;

        margin = (size * effectiveBps) / BPS;
    }

    function calculateDynamicMaintenanceMargin(uint256 size, uint256 leverage) internal pure returns (uint256 margin) {
        uint256 leverageMultiplier = leverage / PRECISION;

        uint256 baseBps = DEFAULT_MAINTENANCE_MARGIN_BPS;
        uint256 additionalBps = 0;

        if (leverageMultiplier > 5) {
            additionalBps = ((leverageMultiplier - 5) / 5) * 50;
        }

        uint256 totalBps = baseBps + additionalBps;
        // Cap dynamic maintenance margin to keep it strictly below initial collateral at any leverage .
        if (totalBps > MAX_DYNAMIC_MAINTENANCE_BPS) {
            totalBps = MAX_DYNAMIC_MAINTENANCE_BPS;
        }

        margin = (size * totalBps) / BPS;

        // ── Initial-margin cap ──
        // The bps curve above grows with leverage, and beyond ~16x it exceeds
        // the position's initial-margin budget (size / leverage). When that
        // happens a freshly-opened position is already liquidatable at entry,
        // which makes high-leverage markets impossible to open. Cap the
        // maintenance margin at `MAINTENANCE_TO_INITIAL_CAP_BPS` (50%) of the
        // initial margin so a new position at ANY configured leverage up to
        // `MAX_LEVERAGE_LIMIT` (100x) opens with a health factor of ~2.0. At
        // low leverage the bps curve is well below this cap and is unaffected.
        if (leverage > 0) {
            uint256 initialMargin = (size * PRECISION) / leverage;
            uint256 cap = (initialMargin * MAINTENANCE_TO_INITIAL_CAP_BPS) / BPS;
            if (margin > cap) {
                margin = cap;
            }
        }
    }

    function calculateLiquidationPrice(
        uint256 entryPrice,
        uint256 leverage,
        uint256 size,
        bool isLong
    ) internal pure returns (uint256 liquidationPrice) {
        if (entryPrice == 0) revert InvalidPrice();
        if (leverage == 0) revert InvalidLeverage();

        uint256 mmMargin = calculateDynamicMaintenanceMargin(size, leverage);
        uint256 mmFraction = size > 0
            ? (mmMargin * PRECISION) / size
            : (DEFAULT_MAINTENANCE_MARGIN_BPS * PRECISION) / BPS;
        uint256 inverseL = (PRECISION * PRECISION) / leverage;

        if (isLong) {
            if (PRECISION + mmFraction <= inverseL) {
                return NO_LIQUIDATION_PRICE;
            }
            uint256 factor = PRECISION + mmFraction - inverseL;
            liquidationPrice = (entryPrice * factor) / PRECISION;
        } else {
            // Short positions: if mm + 1/L >= 1, the position would be liquidatable at any non-zero price.
            // Symmetric handling with the long branch — mark as no-liquidation sentinel and
            // let the higher-level invariant validation reject the configuration on listing.
            if (mmFraction >= PRECISION) {
                return NO_LIQUIDATION_PRICE;
            }
            uint256 factor = PRECISION + inverseL - mmFraction;
            liquidationPrice = (entryPrice * factor) / PRECISION;
        }

        if (liquidationPrice > NO_LIQUIDATION_PRICE) {
            liquidationPrice = NO_LIQUIDATION_PRICE;
        }
    }

    function isLiquidatable(
        DataTypes.Position memory position,
        uint256 currentPrice,
        uint256 collateralValue
    ) internal pure returns (bool, uint256 healthFactor) {
        if (position.state != DataTypes.PosStatus.OPEN) {
            return (false, type(uint256).max);
        }
        if (currentPrice == 0) {
            return (false, type(uint256).max);
        }
        if (position.liquidationPrice >= NO_LIQUIDATION_PRICE && position.flags.isLong()) {
            return (false, type(uint256).max);
        }

        bool _isLong = position.flags.isLong();

        int256 pnl = calculateUnrealizedPnL(
            uint256(position.size),
            uint256(position.entryPrice),
            currentPrice,
            _isLong
        );

        int256 effectiveCollateral = int256(collateralValue) + pnl;

        if (effectiveCollateral <= 0) {
            return (true, 0);
        }

        uint256 maintenanceMargin = calculateDynamicMaintenanceMargin(
            uint256(position.size),
            uint256(position.leverage)
        );

        if (maintenanceMargin == 0) {
            return (false, type(uint256).max);
        }

        healthFactor = (uint256(effectiveCollateral) * PRECISION) / maintenanceMargin;

        return (healthFactor < PRECISION, healthFactor);
    }

    function getPositionPnLExt(
        DataTypes.Position memory position,
        uint256 collateralAmount,
        uint256 currentPrice
    ) internal pure returns (int256 pnl, uint256 healthFactor) {
        if (position.state != DataTypes.PosStatus.OPEN) return (0, 0);
        bool _isLong = (position.flags & 0x01) != 0;
        pnl = calculateUnrealizedPnL(uint256(position.size), uint256(position.entryPrice), currentPrice, _isLong);
        (, healthFactor) = isLiquidatable(position, currentPrice, collateralAmount);
    }

    function canLiquidateExt(
        DataTypes.Position memory position,
        uint256 collateralAmount,
        uint256 currentPrice
    ) internal pure returns (bool liquidatable, uint256 healthFactor) {
        if (position.state != DataTypes.PosStatus.OPEN) return (false, type(uint256).max);
        return isLiquidatable(position, currentPrice, collateralAmount);
    }

    function calculateLiquidationFee(
        uint256 size,
        uint256 healthFactor,
        DataTypes.LiquidationFeeTiers memory tiers
    ) internal pure returns (uint256 fee) {
        uint256 feeBps;

        if (healthFactor >= 8e17) {
            feeBps = tiers.nearThresholdBps;
        } else if (healthFactor >= 5e17) {
            feeBps = tiers.mediumRiskBps;
        } else {
            feeBps = tiers.deeplyUnderwaterBps;
        }

        fee = (size * feeBps) / BPS;
    }

    function calculateFundingRate(
        uint256 longOpenInterest,
        uint256 shortOpenInterest,
        uint256 baseFundingRate
    ) internal pure returns (int256 fundingRate) {
        uint256 totalOI = longOpenInterest + shortOpenInterest;

        if (totalOI == 0) {
            return 0;
        }

        if (longOpenInterest >= shortOpenInterest) {
            uint256 imbalance = ((longOpenInterest - shortOpenInterest) * PRECISION) / totalOI;
            fundingRate = int256((baseFundingRate * imbalance) / PRECISION);
        } else {
            uint256 imbalance = ((shortOpenInterest - longOpenInterest) * PRECISION) / totalOI;
            fundingRate = -int256((baseFundingRate * imbalance) / PRECISION);
        }
    }

    /**
     * @notice Calculate funding owed for a position with overflow protection
     * @dev Uses proper math for all sizes without arbitrary cap.
     * @param position The position
     * @param cumulativeFundingDelta Change in cumulative funding since last update
     * @return fundingOwed Funding amount owed (positive = owes, negative = receives)
     */
    function calculateFundingOwed(
        DataTypes.Position memory position,
        int256 cumulativeFundingDelta
    ) internal pure returns (int256 fundingOwed) {
        if (position.size == 0) return 0;
        if (cumulativeFundingDelta == 0) return 0;

        uint256 posSize = uint256(position.size);
        bool _isLong = position.flags.isLong();

        if (posSize > type(uint128).max) revert PositionSizeTooLarge();

        uint256 absDelta = abs(cumulativeFundingDelta);
        if (absDelta > type(uint128).max) revert FundingDeltaTooLarge();

        int256 rawFunding;

        if (posSize <= type(uint96).max && absDelta <= type(uint96).max) {
            rawFunding = (int256(posSize) * cumulativeFundingDelta) / int256(PRECISION);
        } else {
            uint256 scaledSize = posSize / PRECISION;
            uint256 remainderSize = posSize % PRECISION;
            if (scaledSize > 0 && absDelta > type(uint256).max / scaledSize) revert FundingOverflow();

            int256 mainPart = int256(scaledSize) * cumulativeFundingDelta;

            if (remainderSize > 0) {
                int256 remainderPart = (int256(remainderSize) * cumulativeFundingDelta) / int256(PRECISION);
                rawFunding = mainPart + remainderPart;
            } else {
                rawFunding = mainPart;
            }
        }

        if (_isLong) {
            fundingOwed = rawFunding;
        } else {
            fundingOwed = -rawFunding;
        }
    }

    function calculateFundingIntervals(
        uint64 lastSettlement,
        uint256 currentTime,
        uint256 intervalSeconds
    ) internal pure returns (uint256 intervals) {
        if (currentTime <= lastSettlement) return 0;
        if (intervalSeconds == 0) return 0;
        intervals = (currentTime - uint256(lastSettlement)) / intervalSeconds;
    }

    function validateSlippage(
        uint256 expectedPrice,
        uint256 actualPrice,
        uint256 maxSlippageBps,
        bool isLong
    ) internal pure returns (bool valid) {
        if (expectedPrice == 0) return false;

        uint256 maxDeviation = (expectedPrice * maxSlippageBps) / BPS;

        if (isLong) {
            valid = actualPrice <= expectedPrice + maxDeviation;
        } else {
            valid = actualPrice >= expectedPrice - maxDeviation;
        }
    }

    function shouldTriggerStopLoss(
        DataTypes.Position memory position,
        uint256 currentPrice
    ) internal pure returns (bool shouldTrigger) {
        if (position.stopLossPrice == 0) return false;

        bool _isLong = position.flags.isLong();

        if (_isLong) {
            shouldTrigger = currentPrice <= uint256(position.stopLossPrice);
        } else {
            shouldTrigger = currentPrice >= uint256(position.stopLossPrice);
        }
    }

    function shouldTriggerTakeProfit(
        DataTypes.Position memory position,
        uint256 currentPrice
    ) internal pure returns (bool shouldTrigger) {
        if (position.takeProfitPrice == 0) return false;

        bool _isLong = position.flags.isLong();

        if (_isLong) {
            shouldTrigger = currentPrice >= uint256(position.takeProfitPrice);
        } else {
            shouldTrigger = currentPrice <= uint256(position.takeProfitPrice);
        }
    }

    /// @notice Ratchet the trailing anchor toward favorable price moves.
    function updateTrailingAnchor(
        bool isLong,
        uint256 currentPrice,
        uint256 anchorPrice
    ) internal pure returns (uint256) {
        if (anchorPrice == 0) return currentPrice;
        if (isLong) {
            return currentPrice > anchorPrice ? currentPrice : anchorPrice;
        }
        return currentPrice < anchorPrice ? currentPrice : anchorPrice;
    }

    /// @notice True when price has retraced `trailingStopBps` from the anchor.
    function shouldTriggerTrailingStop(
        DataTypes.Position memory position,
        uint256 currentPrice,
        uint256 anchorPrice
    ) internal pure returns (bool) {
        if (position.trailingStopBps == 0 || anchorPrice == 0) return false;
        bool isLong = position.flags.isLong();
        if (isLong) {
            if (currentPrice >= anchorPrice) return false;
            return ((anchorPrice - currentPrice) * BPS) / anchorPrice >= uint256(position.trailingStopBps);
        }
        if (currentPrice <= anchorPrice) return false;
        return ((currentPrice - anchorPrice) * BPS) / anchorPrice >= uint256(position.trailingStopBps);
    }

    function safeMul(uint256 a, uint256 b) internal pure returns (uint256 result) {
        if (a == 0 || b == 0) return 0;
        result = a * b;
        if (result / a != b) revert OverflowRisk();
    }

    function abs(int256 x) internal pure returns (uint256) {
        if (x == type(int256).min) return uint256(type(int256).max) + 1;
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a <= b ? a : b;
    }
}
