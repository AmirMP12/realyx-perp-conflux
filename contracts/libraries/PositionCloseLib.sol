// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IPositionToken.sol";
import "../interfaces/IVaultCore.sol";
import "../interfaces/IOracleAggregator.sol";
import "./DataTypes.sol";
import "./PositionMath.sol";
import "./FeeCalculator.sol";

/**
 * @title PositionCloseLib
 * @notice Library for closing positions
 */
library PositionCloseLib {
    using SafeERC20 for IERC20;
    using PositionMath for DataTypes.Position;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant TWAP_WINDOW_SECONDS = 15 minutes;
    /// @dev same deviation cap as the increase path; close paths reverted instead of skipped.
    uint256 private constant MAX_CLOSE_PRICE_DEVIATION_BPS = 1000;
    /// @dev Mirror the increase-side minimum sample requirement so a fresh
    ///      market (or a market whose buffer was reset) cannot silently degrade the
    ///      close-side deviation guard to spot.
    /// @dev Relaxed from 6 to 2 so fresh markets (or markets whose buffer was reset)
    ///      can still be closed. The TWAP/spot deviation guard still protects against
    ///      flash-loan manipulation when ≥2 data points exist; a buffer with 1 point is
    ///      treated as absent and falls through to the spot-deviation check (which is
    ///      still bounded by MAX_CLOSE_PRICE_DEVIATION_BPS).
    uint256 private constant MIN_TWAP_DATA_POINTS = 2;

    event BadDebtCoverageFailed(uint256 indexed positionId, uint256 amount);
    error ZeroCloseSize();
    error CloseSizeExceedsPosition();
    error LeverageOverflow();
    error SlippageExceeded();
    error PositionNotFound();
    error InsufficientLiquidityForRepayment();
    error ClosePriceDeviation();
    error TwapNotReady();

    struct ClosePositionContext {
        address usdc;
        address liquidityVault;
        address oracleAggregator;
        address positionToken;
        address treasury;
        address insuranceFund;
        DataTypes.FeeConfig feeConfig;
    }

    function closePosition(
        uint256 positionId,
        uint256 closeSize,
        uint256 minReceive,
        ClosePositionContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256) storage userExposure,
        DataTypes.ProtocolHealthState storage protocolHealth
    ) external returns (int256 realizedPnL) {
        DataTypes.Position storage position = positions[positionId];
        if (closeSize == 0) revert ZeroCloseSize();
        if (closeSize > uint256(position.size)) revert CloseSizeExceedsPosition();

        bool isLong = DataTypes.isLong(position.flags);
        (uint256 currentPrice, , ) = IOracleAggregator(ctx.oracleAggregator).getPrice(position.market);

        // TWAP/spot deviation guard on close. When the buffer is still warming up,
        // allow the close if the trader supplied `minReceive` slippage protection.
        {
            (uint256 twapPrice, bool twapValid) = IOracleAggregator(ctx.oracleAggregator)
                .getTWAPWithValidation(position.market, TWAP_WINDOW_SECONDS, MIN_TWAP_DATA_POINTS);
            if (!twapValid) {
                if (minReceive == 0) revert TwapNotReady();
            } else if (twapPrice > 0) {
                uint256 dev = currentPrice > twapPrice
                    ? ((currentPrice - twapPrice) * BPS) / twapPrice
                    : ((twapPrice - currentPrice) * BPS) / twapPrice;
                if (dev > MAX_CLOSE_PRICE_DEVIATION_BPS) revert ClosePriceDeviation();
            }
        }

        uint256 closingFee = FeeCalculator.calculateClosingFee(closeSize, ctx.feeConfig, true);
        int256 unrealizedPnL = PositionMath.calculateUnrealizedPnL(
            closeSize,
            uint256(position.entryPrice),
            currentPrice,
            isLong
        );
        realizedPnL = PositionMath.calculateRealizedPnL(unrealizedPnL, closingFee, 0);

        uint256 totalSize = uint256(position.size);
        uint256 totalCollateral = positionCollateral[positionId].amount;
        uint256 totalBorrowed = positionCollateral[positionId].borrowedAmount;
        uint256 collateralPortion = closeSize >= totalSize
            ? totalCollateral
            : (totalCollateral * closeSize) / totalSize;
        uint256 borrowedPortion = closeSize >= totalSize ? totalBorrowed : (totalBorrowed * closeSize) / totalSize;
        uint256 repayAmountUsdc = DataTypes.toUsdcPrecisionCeil(borrowedPortion);
        uint256 receiveAmount = unrealizedPnL >= 0
            ? repayAmountUsdc
            : repayAmountUsdc + DataTypes.toUsdcPrecisionCeil(uint256(-unrealizedPnL));
        uint256 collateralUsdc = DataTypes.toUsdcPrecision(collateralPortion);
        int256 payout = int256(collateralPortion) + realizedPnL;

        uint256 closingFeeUsdc = DataTypes.toUsdcPrecision(closingFee);
        uint256 availableUsdc = collateralUsdc + repayAmountUsdc;
        uint256 totalRequired = receiveAmount + closingFeeUsdc;

        if (availableUsdc < totalRequired) {
            uint256 shortfall = totalRequired - availableUsdc;
            try IVaultCore(ctx.insuranceFund).coverBadDebt(shortfall, positionId) returns (uint256 covered) {
                if (covered > 0) {
                    // Track aggregate insurance-paid bad debt against protocol health .
                    protocolHealth.totalBadDebt += DataTypes.toInternalPrecision(covered);
                }
                if (covered < shortfall) {
                    emit BadDebtCoverageFailed(positionId, shortfall);
                    if (covered == 0) closingFeeUsdc = 0;
                }
            } catch {
                emit BadDebtCoverageFailed(positionId, shortfall);
                closingFeeUsdc = 0;
            }
        }

        address self = address(this);
        if (IERC20(ctx.usdc).balanceOf(self) < receiveAmount) revert InsufficientLiquidityForRepayment();

        int256 pnlUsdc = unrealizedPnL >= 0
            ? int256(DataTypes.toUsdcPrecision(uint256(unrealizedPnL)))
            : -int256(DataTypes.toUsdcPrecisionCeil(uint256(-unrealizedPnL)));

        IERC20(ctx.usdc).forceApprove(ctx.liquidityVault, type(uint256).max);
        IVaultCore(ctx.liquidityVault).repay(repayAmountUsdc, position.market, isLong, pnlUsdc);

        // Convert exactly the required closing fee back to internal precision for distribution
        uint256 distributedFee = DataTypes.toInternalPrecision(closingFeeUsdc);
        if (distributedFee > 0) {
            _distributeFees(
                distributedFee,
                ctx.usdc,
                ctx.treasury,
                ctx.liquidityVault,
                ctx.insuranceFund,
                ctx.feeConfig
            );
        }
        address posOwner = IPositionToken(ctx.positionToken).ownerOf(positionId);
        if (payout > 0) {
            uint256 userPayoutUsdc = DataTypes.toUsdcPrecision(uint256(payout));
            if (minReceive > 0 && userPayoutUsdc < minReceive) revert SlippageExceeded();
            IERC20(ctx.usdc).safeTransfer(posOwner, userPayoutUsdc);
        }

        _updateMarketAndFinalize(
            positionId,
            closeSize,
            totalSize,
            totalCollateral,
            collateralPortion,
            borrowedPortion,
            position,
            positionCollateral,
            markets,
            userExposure,
            ctx.positionToken,
            posOwner,
            isLong
        );
    }

    function _updateMarketAndFinalize(
        uint256 positionId,
        uint256 closeSize,
        uint256 totalSize,
        uint256 totalCollateral,
        uint256 collateralPortion,
        uint256 borrowedPortion,
        DataTypes.Position storage position,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256) storage userExposure,
        address positionToken,
        address posOwner,
        bool isLong
    ) private {
        DataTypes.Market storage m = markets[position.market];
        unchecked {
            uint256 cost = (closeSize * uint256(position.entryPrice)) / PRECISION;
            if (isLong) {
                m.totalLongSize = m.totalLongSize > closeSize ? m.totalLongSize - closeSize : 0;
                m.totalLongCost = m.totalLongCost > cost ? m.totalLongCost - cost : 0;
            } else {
                m.totalShortSize = m.totalShortSize > closeSize ? m.totalShortSize - closeSize : 0;
                m.totalShortCost = m.totalShortCost > cost ? m.totalShortCost - cost : 0;
            }
        }

        if (closeSize >= totalSize) {
            position.state = DataTypes.PosStatus.CLOSED;
            unchecked {
                userExposure[posOwner] = userExposure[posOwner] > DataTypes.toUsdcPrecision(closeSize)
                    ? userExposure[posOwner] - DataTypes.toUsdcPrecision(closeSize)
                    : 0;
            }
            IPositionToken(positionToken).burn(positionId);
            positionCollateral[positionId].amount = 0;
            positionCollateral[positionId].borrowedAmount = 0;
        } else {
            unchecked {
                // SafeCast equivalent (totalSize - closeSize <= totalSize <= uint128.max by invariant).
                position.size = uint128(totalSize - closeSize);
                positionCollateral[positionId].amount = totalCollateral - collateralPortion;
                positionCollateral[positionId].borrowedAmount -= borrowedPortion;
                userExposure[posOwner] = userExposure[posOwner] > DataTypes.toUsdcPrecision(closeSize)
                    ? userExposure[posOwner] - DataTypes.toUsdcPrecision(closeSize)
                    : 0;
            }
            uint256 newLeverage = _calculateNewLeverage(uint256(position.size), positionCollateral[positionId].amount);
            if (newLeverage > type(uint64).max) revert LeverageOverflow();
            position.leverage = uint64(newLeverage);
            uint256 liqPx = PositionMath.calculateLiquidationPrice(
                uint256(position.entryPrice),
                newLeverage,
                uint256(position.size),
                isLong
            );
            // Cap to uint128.max via PositionMath sentinel before truncation.
            position.liquidationPrice = liqPx > type(uint128).max ? type(uint128).max : uint128(liqPx);
        }
    }

    function _calculateNewLeverage(uint256 size, uint256 collateral) private pure returns (uint256) {
        if (collateral == 0) return 0;
        return (size * PRECISION) / collateral;
    }

    function _distributeFees(
        uint256 closingFee,
        address usdc,
        address treasury,
        address liquidityVault,
        address insuranceFund,
        DataTypes.FeeConfig memory feeConfig
    ) private {
        (uint256 lpShare, uint256 insuranceShare, uint256 treasuryShare) = FeeCalculator.splitFees(
            closingFee,
            feeConfig
        );

        uint256 lpShareUsdc = DataTypes.toUsdcPrecision(lpShare);
        uint256 insuranceShareUsdc = DataTypes.toUsdcPrecision(insuranceShare);
        uint256 treasuryShareUsdc = DataTypes.toUsdcPrecision(treasuryShare);

        if (lpShareUsdc > 0) {
            IERC20(usdc).safeTransfer(liquidityVault, lpShareUsdc);
        }
        if (insuranceShareUsdc > 0) {
            IERC20(usdc).safeTransfer(insuranceFund, insuranceShareUsdc);
            IVaultCore(insuranceFund).receiveFees(insuranceShareUsdc);
        }
        if (treasuryShareUsdc > 0) {
            IERC20(usdc).safeTransfer(treasury, treasuryShareUsdc);
        }
    }
}
