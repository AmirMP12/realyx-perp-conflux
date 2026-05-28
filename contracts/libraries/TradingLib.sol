// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IPositionToken.sol";
import "../interfaces/IVaultCore.sol";
import "../interfaces/IOracleAggregator.sol";
import "../interfaces/ITradingCore.sol";
import "./DataTypes.sol";
import "./PositionMath.sol";
import "./FeeCalculator.sol";
import "./FundingLib.sol";
import "./LiquidationLib.sol";
import "./PositionCloseLib.sol";
import "./DividendSettlementLib.sol";
import "../interfaces/IDividendManager.sol";
import "../interfaces/IMarketCalendar.sol";
import "../interfaces/IReferralRegistry.sol";

/**
 * @title TradingLib
 * @notice Unified library for all trading operations
 */
library TradingLib {
    using SafeERC20 for IERC20;
    using PositionMath for DataTypes.Position;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant BASE_FUNDING_RATE = 1e14;
    uint256 private constant MAX_ACTIVE_POSITIONS_QUERY = 100;
    uint256 private constant MAX_LIQUIDATION_PRICE_DEVIATION_BPS = 1000;
    uint256 private constant MAX_OPEN_PRICE_DEVIATION_BPS = 500;
    uint256 private constant TWAP_WINDOW_SECONDS = 15 minutes;
    uint256 private constant MIN_LIQUIDATOR_REWARD_BPS = 2500;

    event FundingSettled(address indexed market, int256 fundingRate, int256 cumulativeFunding, uint256 timestamp);
    event FundingShortfall(uint256 indexed positionId, uint256 shortfall);
    event PositionUnderwaterAfterFunding(uint256 indexed positionId, uint256 shortfall);
    event FeesDistributed(uint256 lpShare, uint256 insuranceShare, uint256 treasuryShare);
    event PrecisionLossTracked(uint256 indexed positionId, uint256 dustAmount);
    event BadDebtCoverageFailed(uint256 indexed positionId, uint256 amount);
    event DustAccumulated(uint256 amount, uint256 totalDust);
    event RepaymentFailed(uint256 indexed positionId, uint256 amount, string reason);
    event InsufficientBalanceForLiquidation(uint256 indexed positionId, uint256 needed, uint256 available);

    error MarketNotActive();
    error InvalidOraclePrice();
    error ExceedsMaxLeverage();
    error ExceedsMaxPositionSize();
    error ExceedsMaxTotalExposure();
    error InsufficientLiquidity();
    error ZeroAddress();
    error LiquidationPriceDeviation();
    error SlippageExceeded();
    error CloseSizeExceedsPosition();
    error ZeroCloseSize();
    error PositionNotFound();
    error PositionNotLiquidatable();
    error OpenPriceDeviation();
    error InsufficientLiquidatorReward();
    error RepaymentFailedCritical();
    error TransferToContractNotAllowed();
    error InsufficientCollateral();
    error CommitRevealRequired();
    error MaxPositionsExceeded();
    error LeverageOverflow();
    error PositionTooSmall();
    error RateLimitExceededOpen();
    error EthRefundFailed();

    error NotPositionOwner();
    error MinPositionDuration();
    error InvalidOrder();
    error OrderNotFound();
    error ExecutionFeeTooLow();
    error BreakerActive();
    error Unauthorized();
    error RepaymentValidationFailed();
    error InvalidOrResolvedFailedRepayment();
    error OrderUnfillableCancel();
    error TWAPIntervalNotMet();
    error MarketHoursClosed();

    event FailedRepaymentRecorded(uint256 indexed positionId, uint256 amount, address market, bool isLong, int256 pnl);
    event FailedRepaymentResolved(uint256 indexed positionId, uint256 amount, address resolver);

    struct OpenPositionContext {
        address market;
        bool isLong;
        uint256 size;
        uint256 leverage;
        uint256 stopLossPrice;
        uint256 takeProfitPrice;
        uint256 trailingStopBps;
        uint256 maxOracleUncertainty;
        address usdc;
        address liquidityVault;
        address oracleAggregator;
        address positionToken;
        address treasury;
        address insuranceFund;
        address collateralRegistry;
        DataTypes.FeeConfig feeConfig;
        uint256 currentPrice;
        // Risk gates evaluated on increase (USDC-precision unless noted)
        uint256 minPositionSize;
        uint256 maxUserExposure;
        uint256 userDailyVolumeLimit;
        uint256 globalDailyVolumeLimit;
        bool defaultCrossMargin;
        // Referral data resolved off the registry once per execution.
        address referrer;
        uint16 referralDiscountBps;
        uint16 referralRebateBps;
    }

    struct ClosePositionContext {
        address usdc;
        address liquidityVault;
        address oracleAggregator;
        address positionToken;
        address treasury;
        address insuranceFund;
        address collateralRegistry;
        DataTypes.FeeConfig feeConfig;
        // Referral data resolved off the registry for the position owner.
        address referrer;
        uint16 referralDiscountBps;
        uint16 referralRebateBps;
    }

    struct LiquidatePositionContext {
        address usdc;
        address liquidityVault;
        address oracleAggregator;
        address positionToken;
        address treasury;
        address insuranceFund;
        address tradingCore;
        address collateralRegistry;
        DataTypes.LiquidationFeeTiers liquidationTiers;
        uint256 liquidationDeviationBps;
    }

    struct CollateralContext {
        address usdc;
        address oracleAggregator;
        address collateralRegistry;
        address collateralToken;
        uint256 maxOracleUncertainty;
    }

    /// @notice Helper to push fresh Pyth prices and refund any unused ETH to the keeper, called from `TradingCore.executeOrder`.
    /// @dev Returns nothing; reverts on insufficient fee or failed refund.
    function applyPythUpdateAndRefund(
        address oracleAggregator,
        bytes[] calldata priceUpdateData,
        uint256 ethValue,
        address keeper
    ) external {
        if (ethValue == 0 && priceUpdateData.length == 0) return;
        uint256 refund = priceUpdateData.length > 0
            ? IOracleAggregator(oracleAggregator).updatePrices{value: ethValue}(priceUpdateData)
            : ethValue;
        if (refund > 0) {
            (bool ok, ) = keeper.call{value: refund}("");
            if (!ok) revert EthRefundFailed();
        }
    }

    function checkVolumeLimit(
        mapping(address => mapping(uint256 => uint256)) storage userDailyVolume,
        mapping(uint256 => uint256) storage globalDailyVolume,
        address user,
        uint256 size,
        uint256 userLimit,
        uint256 globalLimit
    ) public view returns (bool) {
        uint256 day = block.timestamp - (block.timestamp % 1 days);
        if (userDailyVolume[user][day] + size > userLimit) return false;
        if (globalDailyVolume[day] + size > globalLimit) return false;
        return true;
    }

    function updateVolume(
        mapping(address => mapping(uint256 => uint256)) storage userDailyVolume,
        mapping(uint256 => uint256) storage globalDailyVolume,
        address user,
        uint256 size
    ) public {
        uint256 day = block.timestamp - (block.timestamp % 1 days);
        userDailyVolume[user][day] += size;
        globalDailyVolume[day] += size;
    }

    function calculateNewLeverage(uint256 size, uint256 collateral) public pure returns (uint256) {
        if (collateral == 0) return type(uint256).max;
        return (size * PRECISION) / collateral;
    }

    /// @dev Stored leverage uses uint64 in `Position` (1e18-precision); guard against silent truncation above ~18.4x.
    function _toLeverageU64(uint256 lev) private pure returns (uint64) {
        if (lev > type(uint64).max) revert LeverageOverflow();
        return uint64(lev);
    }

    function settleFunding(
        DataTypes.FundingState storage fundingState,
        DataTypes.Market storage m,
        address market
    ) external returns (int256 fundingRate) {
        return FundingLib.settleFunding(fundingState, m, market);
    }

    function applyFundingToCollateral(
        DataTypes.PositionCollateral storage collateral,
        int256 fundingPaid,
        uint256 positionId
    ) public returns (uint256 newCollateral, uint256 shortfall) {
        return FundingLib.applyFundingToCollateral(collateral, fundingPaid, positionId);
    }

    function getPositionPnL(
        DataTypes.Position storage position,
        DataTypes.PositionCollateral storage collateral,
        uint256 currentPrice
    ) public view returns (int256 pnl, uint256 healthFactor) {
        if (position.state != DataTypes.PosStatus.OPEN) return (0, 0);

        pnl = PositionMath.calculateUnrealizedPnL(
            uint256(position.size),
            uint256(position.entryPrice),
            currentPrice,
            DataTypes.isLong(position.flags)
        );
        (, healthFactor) = position.isLiquidatable(currentPrice, collateral.amount);
    }

    function canLiquidate(
        DataTypes.Position storage position,
        DataTypes.PositionCollateral storage collateral,
        uint256 currentPrice
    ) public view returns (bool liquidatable, uint256 healthFactor) {
        return LiquidationLib.canLiquidate(position, collateral, currentPrice);
    }

    function getUserPositionsPaginated(
        uint256[] storage allPositions,
        uint256 offset,
        uint256 limit
    ) public view returns (uint256[] memory positionIds, uint256 total) {
        total = allPositions.length;
        if (offset >= total || limit == 0) return (new uint256[](0), total);

        uint256 end = offset + limit > total ? total : offset + limit;
        positionIds = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ) {
            positionIds[i - offset] = allPositions[i];
            unchecked {
                ++i;
            }
        }
    }

    function getActivePositions(
        uint256[] storage allPositions,
        mapping(uint256 => DataTypes.Position) storage positions
    ) public view returns (uint256[] memory positionIds) {
        uint256 len = allPositions.length;
        uint256 scanLimit = len > MAX_ACTIVE_POSITIONS_QUERY * 2 ? MAX_ACTIVE_POSITIONS_QUERY * 2 : len;
        uint256 activeCount;

        for (uint256 i = 0; i < scanLimit && activeCount < MAX_ACTIVE_POSITIONS_QUERY; ) {
            if (positions[allPositions[i]].state == DataTypes.PosStatus.OPEN) {
                unchecked {
                    ++activeCount;
                }
            }
            unchecked {
                ++i;
            }
        }

        positionIds = new uint256[](activeCount);
        uint256 idx;
        for (uint256 i = 0; i < scanLimit && idx < activeCount; ) {
            if (positions[allPositions[i]].state == DataTypes.PosStatus.OPEN) {
                positionIds[idx] = allPositions[i];
                unchecked {
                    ++idx;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function addCollateral(
        uint256 positionId,
        uint256 amount,
        uint256 maxLeverage,
        bool isEmergency,
        CollateralContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets
    ) public {
        DataTypes.Position storage p = positions[positionId];
        DataTypes.Market storage m = markets[p.market];

        if (isEmergency) {
            if (m.isActive) revert MarketNotActive();
        } else {
            (uint256 pr, uint256 cf, ) = IOracleAggregator(ctx.oracleAggregator).getPrice(p.market);
            if (pr == 0 || cf > ctx.maxOracleUncertainty / 2) revert InvalidOraclePrice();
        }

        uint256 internalValue;
        if (p.collateralToken != address(0)) {
            IERC20(p.collateralToken).safeTransferFrom(msg.sender, address(this), amount);
            internalValue = DataTypes.toInternalPrecision(
                CollateralRegistry(ctx.collateralRegistry).getCollateralValue(p.collateralToken, amount, false)
            );
        } else {
            IERC20(ctx.usdc).safeTransferFrom(msg.sender, address(this), amount);
            internalValue = DataTypes.toInternalPrecision(amount);
        }

        positionCollateral[positionId].amount += internalValue;

        uint256 lev = calculateNewLeverage(uint256(p.size), positionCollateral[positionId].amount);
        if (maxLeverage > 0 && lev > maxLeverage * PRECISION) revert ExceedsMaxLeverage();

        p.leverage = _toLeverageU64(lev);
        p.liquidationPrice = uint128(
            PositionMath.calculateLiquidationPrice(
                uint256(p.entryPrice),
                lev,
                uint256(p.size),
                DataTypes.isLong(p.flags)
            )
        );
    }

    function withdrawCollateral(
        uint256 positionId,
        uint256 amount,
        CollateralContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets
    ) public {
        DataTypes.Position storage p = positions[positionId];
        DataTypes.Market storage m = markets[p.market];
        DataTypes.PositionCollateral storage col = positionCollateral[positionId];

        uint256 intValue;
        if (p.collateralToken != address(0)) {
            intValue = DataTypes.toInternalPrecision(
                CollateralRegistry(ctx.collateralRegistry).getCollateralValue(p.collateralToken, amount, false)
            );
        } else {
            intValue = DataTypes.toInternalPrecision(amount);
        }

        uint256 minCol = (uint256(p.size) * m.initialMargin) / BPS;

        if (col.amount < intValue + minCol) revert InsufficientCollateral();

        (uint256 price, , ) = IOracleAggregator(ctx.oracleAggregator).getPrice(p.market);
        (bool liq, ) = p.isLiquidatable(price, col.amount - intValue);
        if (liq) revert InsufficientCollateral();

        col.amount -= intValue;
        uint256 lev = calculateNewLeverage(uint256(p.size), col.amount);

        if (lev > uint256(m.maxLeverage) * PRECISION) revert ExceedsMaxLeverage();

        p.leverage = _toLeverageU64(lev);
        p.liquidationPrice = uint128(
            PositionMath.calculateLiquidationPrice(
                uint256(p.entryPrice),
                lev,
                uint256(p.size),
                DataTypes.isLong(p.flags)
            )
        );

        if (p.collateralToken != address(0)) {
            IERC20(p.collateralToken).safeTransfer(msg.sender, amount);
        } else {
            IERC20(ctx.usdc).safeTransfer(msg.sender, amount);
        }
    }

    function updatePositionOwner(
        uint256 positionId,
        address newOwner,
        address oldOwner,
        uint256 maxUserExposure,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(address => uint256) storage userExposure
    ) public {
        if (newOwner == address(0)) revert ZeroAddress();

        // Contract recipients are allowed when whitelisted on the position token. Compliance gate
        // is enforced upstream at `TradingCore.updatePositionOwner` for sanctioned addresses.
        // Note: the previous blanket extcodesize revert blocked smart-account wallets, escrows and
        // lending protocols from receiving position NFTs .

        DataTypes.Position storage pos = positions[positionId];
        if (pos.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();

        uint256 sz = DataTypes.toUsdcPrecision(uint256(pos.size));

        if (userExposure[newOwner] + sz > maxUserExposure) {
            revert ExceedsMaxTotalExposure();
        }

        userExposure[oldOwner] = userExposure[oldOwner] > sz ? userExposure[oldOwner] - sz : 0;
        userExposure[newOwner] += sz;
    }

    function settlePositionFunding(
        uint256 positionId,
        address oracleAggregator,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.FundingState) storage fundingStates,
        mapping(uint256 => int256) storage positionCumulativeFunding
    ) external returns (int256 paid) {
        return
            FundingLib.settlePositionFunding(
                positionId,
                oracleAggregator,
                positions,
                positionCollateral,
                fundingStates,
                positionCumulativeFunding
            );
    }

    function checkMarketOpen(
        address market,
        IMarketCalendar calendar,
        mapping(address => string) storage marketIds
    ) external view returns (bool) {
        if (address(calendar) == address(0)) return true;
        string memory mId = marketIds[market];
        if (bytes(mId).length == 0) return true;
        return calendar.isMarketOpen(mId);
    }

    function settlePositionFundingWithDividends(
        uint256 positionId,
        address oracleAggregator,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.FundingState) storage fundingStates,
        mapping(uint256 => int256) storage positionCumulativeFunding,
        IDividendManager dividendManager,
        mapping(address => string) storage marketIds,
        mapping(uint256 => uint256) storage positionDividendIndex
    ) external returns (int256 paid) {
        paid = FundingLib.settlePositionFunding(
            positionId,
            oracleAggregator,
            positions,
            positionCollateral,
            fundingStates,
            positionCumulativeFunding
        );
        if (address(dividendManager) != address(0)) {
            DataTypes.Position storage p = positions[positionId];
            string memory mId = marketIds[p.market];
            if (bytes(mId).length > 0) {
                (int256 divAmount, uint256 newIndex) = DividendSettlementLib.settleDividends(
                    positionId,
                    p,
                    mId,
                    positionDividendIndex[positionId],
                    dividendManager
                );
                if (newIndex > positionDividendIndex[positionId]) {
                    positionDividendIndex[positionId] = newIndex;
                    if (divAmount != 0)
                        applyFundingToCollateral(positionCollateral[positionId], -divAmount, positionId);
                }
            }
        }
    }

    function createOrder(
        uint256 nextOrderId,
        DataTypes.CreateOrderParams calldata params,
        uint256 executionFee,
        address msgSender,
        uint256 minExecutionFee,
        address oracleAggregatorAddr,
        address usdcAddr,
        mapping(uint256 => DataTypes.Order) storage orders
    ) external returns (uint256 orderId) {
        if (executionFee < minExecutionFee) revert ExecutionFeeTooLow();
        orderId = nextOrderId;
        bool openingIncrease = (params.orderType == DataTypes.OrderType.MARKET_INCREASE ||
            params.orderType == DataTypes.OrderType.LIMIT_INCREASE);
        if (openingIncrease) {
            if (!IOracleAggregator(oracleAggregatorAddr).isActionAllowed(params.market, 0)) revert BreakerActive();
            uint256 totalRequired = params.collateralDelta;
            if (totalRequired > 0) IERC20(usdcAddr).safeTransferFrom(msgSender, address(this), totalRequired);
        }
        // For reduce-only decrease orders, derive positionId from params
        orders[orderId] = DataTypes.Order({
            id: orderId,
            account: msgSender,
            market: params.market,
            sizeDelta: params.sizeDelta,
            collateralDelta: params.collateralDelta,
            triggerPrice: params.triggerPrice,
            positionId: params.positionId,
            isLong: params.isLong,
            orderType: params.orderType,
            timestamp: block.timestamp,
            executionFee: executionFee,
            maxSlippage: params.maxSlippage,
            collateralType: params.collateralType,
            collateralToken: params.collateralToken,
            tif: params.tif,
            stopLossPrice: openingIncrease ? params.stopLossPrice : 0,
            takeProfitPrice: openingIncrease ? params.takeProfitPrice : 0,
            visibleSize: params.visibleSize,
            twapInterval: params.twapInterval > 0 ? params.twapInterval : DataTypes.DEFAULT_TWAP_INTERVAL,
            lastExecutionTime: 0,
            isReduceOnly: params.isReduceOnly
        });
    }

    /// @notice Per-call risk-gate parameters threaded into `executeOrderFull` to keep the entry signature flat.
    struct OrderRiskParams {
        uint256 maxOracleUncertainty;
        uint256 minPositionSize;
        uint256 maxUserExposure;
        uint256 userDailyVolumeLimit;
        uint256 globalDailyVolumeLimit;
        bool defaultCrossMargin;
        address collateralRegistry;
        address collateralToken;
        // Optional ReferralRegistry; address(0) disables referral discounts/rebates.
        address referralRegistry;
    }

    function executeOrderFull(
        uint256 orderId,
        address oracleAggregatorAddr,
        OrderRiskParams memory riskParams,
        address usdcAddr,
        address vaultAddr,
        address positionTokenAddr,
        address treasuryAddr,
        DataTypes.FeeConfig memory feeConfig,
        mapping(uint256 => DataTypes.Order) storage orders,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256[]) storage userPositions,
        mapping(address => uint256) storage userExposure,
        uint256 nextPositionId,
        IDividendManager dividendManager,
        mapping(address => string) storage marketIds,
        mapping(uint256 => uint256) storage positionDividendIndex,
        mapping(address => mapping(uint256 => uint256)) storage userDailyVolume,
        mapping(uint256 => uint256) storage globalDailyVolume,
        DataTypes.ProtocolHealthState storage protocolHealth
    ) external returns (uint256 positionId, uint256 orderIdOut, uint256 executionFee, bool isIncrease) {
        DataTypes.Order memory order = orders[orderId];
        if (order.account == address(0)) revert OrderNotFound();
        orderIdOut = orderId;
        isIncrease = (order.orderType == DataTypes.OrderType.MARKET_INCREASE ||
            order.orderType == DataTypes.OrderType.LIMIT_INCREASE);
        (uint256 currentPrice, , ) = IOracleAggregator(oracleAggregatorAddr).getPrice(order.market);
        if (order.orderType == DataTypes.OrderType.LIMIT_INCREASE) {
            if (
                (order.isLong && currentPrice > order.triggerPrice) ||
                (!order.isLong && currentPrice < order.triggerPrice)
            ) revert InvalidOrder();
        }
        // Slippage check: only enforce for MARKET_INCREASE / *_DECREASE; LIMIT fills better than trigger are accepted.
        if (
            order.orderType != DataTypes.OrderType.LIMIT_INCREASE &&
            order.orderType != DataTypes.OrderType.LIMIT_DECREASE &&
            order.maxSlippage > 0 &&
            order.triggerPrice > 0
        ) {
            uint256 priceDeviation = currentPrice > order.triggerPrice
                ? ((currentPrice - order.triggerPrice) * BPS) / order.triggerPrice
                : ((order.triggerPrice - currentPrice) * BPS) / order.triggerPrice;
            if (priceDeviation > order.maxSlippage) revert SlippageExceeded();
        }
        OpenPositionContext memory ctx = OpenPositionContext({
            market: order.market,
            isLong: order.isLong,
            size: order.sizeDelta,
            leverage: 0,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            trailingStopBps: 0,
            maxOracleUncertainty: riskParams.maxOracleUncertainty,
            usdc: usdcAddr,
            liquidityVault: vaultAddr,
            oracleAggregator: oracleAggregatorAddr,
            positionToken: positionTokenAddr,
            treasury: treasuryAddr,
            insuranceFund: vaultAddr,
            collateralRegistry: riskParams.collateralRegistry,
            feeConfig: feeConfig,
            currentPrice: currentPrice,
            minPositionSize: riskParams.minPositionSize,
            maxUserExposure: riskParams.maxUserExposure,
            userDailyVolumeLimit: riskParams.userDailyVolumeLimit,
            globalDailyVolumeLimit: riskParams.globalDailyVolumeLimit,
            defaultCrossMargin: riskParams.defaultCrossMargin,
            referrer: address(0),
            referralDiscountBps: 0,
            referralRebateBps: 0
        });
        if (riskParams.referralRegistry != address(0)) {
            (ctx.referrer, ctx.referralDiscountBps, ctx.referralRebateBps) = _safeGetReferral(
                riskParams.referralRegistry,
                order.account
            );
        }
        positionId = executeOrderInternal(
            order,
            ctx,
            positions,
            positionCollateral,
            markets,
            userPositions,
            userExposure,
            nextPositionId,
            userDailyVolume,
            globalDailyVolume,
            protocolHealth
        );
        if (isIncrease) {
            if (address(dividendManager) != address(0)) {
                string memory mId = marketIds[order.market];
                if (bytes(mId).length > 0) positionDividendIndex[positionId] = dividendManager.getDividendIndex(mId);
            }
            // Volume tracking lives off the ReferralRegistry so tier promotion
            // is decoupled from the protocol's daily-volume rate-limit. Skipped
            // when the registry is not configured.
            if (riskParams.referralRegistry != address(0) && order.sizeDelta > 0) {
                try IReferralRegistry(riskParams.referralRegistry).recordReferralVolume(order.account, order.sizeDelta) {
                    // ok
                } catch {
                    // never let a registry hiccup brick a trade
                }
            }
        }
        executionFee = order.executionFee;
    }

    /// @dev Public-but-internal-style dispatcher kept on the library to allow `delegatecall` from `TradingCore`.
    function executeOrderInternal(
        DataTypes.Order memory order,
        OpenPositionContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256[]) storage userPositions,
        mapping(address => uint256) storage userExposure,
        uint256 nextPosId,
        mapping(address => mapping(uint256 => uint256)) storage userDailyVolume,
        mapping(uint256 => uint256) storage globalDailyVolume,
        DataTypes.ProtocolHealthState storage protocolHealth
    ) public returns (uint256 positionId) {
        if (
            order.orderType == DataTypes.OrderType.MARKET_INCREASE ||
            order.orderType == DataTypes.OrderType.LIMIT_INCREASE
        ) {
            return
                _executeIncrease(
                    order,
                    ctx,
                    positions,
                    positionCollateral,
                    markets,
                    userPositions,
                    userExposure,
                    nextPosId,
                    userDailyVolume,
                    globalDailyVolume
                );
        }
        if (
            order.orderType == DataTypes.OrderType.MARKET_DECREASE ||
            order.orderType == DataTypes.OrderType.LIMIT_DECREASE
        ) {
            return
                _executeDecrease(
                    order,
                    ctx,
                    positions,
                    positionCollateral,
                    markets,
                    userExposure,
                    protocolHealth
                );
        }
        revert InvalidOrder();
    }

    function _executeDecrease(
        DataTypes.Order memory order,
        OpenPositionContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256) storage userExposure,
        DataTypes.ProtocolHealthState storage protocolHealth
    ) private returns (uint256) {
        uint256 posId = order.positionId;
        DataTypes.Position storage position = positions[posId];
        if (position.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();
        if (IPositionToken(ctx.positionToken).ownerOf(posId) != order.account) revert NotPositionOwner();

        if (order.orderType == DataTypes.OrderType.LIMIT_DECREASE && order.triggerPrice > 0) {
            (uint256 currentPrice, , ) = IOracleAggregator(ctx.oracleAggregator).getPrice(position.market);
            bool isLong = DataTypes.isLong(position.flags);
            if ((isLong && currentPrice < order.triggerPrice) || (!isLong && currentPrice > order.triggerPrice)) {
                revert InvalidOrder();
            }
        }

        ClosePositionContext memory closeCtx = ClosePositionContext(
            ctx.usdc,
            ctx.liquidityVault,
            ctx.oracleAggregator,
            ctx.positionToken,
            ctx.treasury,
            ctx.insuranceFund,
            ctx.collateralRegistry,
            ctx.feeConfig,
            ctx.referrer,
            ctx.referralDiscountBps,
            ctx.referralRebateBps
        );

        uint256 closeSizeInternal = order.sizeDelta > 0
            ? DataTypes.toInternalPrecision(order.sizeDelta)
            : uint256(position.size);
        if (closeSizeInternal > uint256(position.size)) closeSizeInternal = uint256(position.size);

        closePosition(
            posId,
            closeSizeInternal,
            0,
            closeCtx,
            positions,
            positionCollateral,
            markets,
            userExposure,
            protocolHealth
        );
        return posId;
    }

    function _executeIncrease(
        DataTypes.Order memory order,
        OpenPositionContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256[]) storage userPositions,
        mapping(address => uint256) storage userExposure,
        uint256 nextPosId,
        mapping(address => mapping(uint256 => uint256)) storage userDailyVolume,
        mapping(uint256 => uint256) storage globalDailyVolume
    ) private returns (uint256 positionId) {
        DataTypes.Market storage m = markets[order.market];
        if (!m.isActive || !m.isListed) revert MarketNotActive();

        uint256 internalSize = DataTypes.toInternalPrecision(order.sizeDelta);

        // ---- Risk gates that the entry layer was previously missing ----
        if (ctx.minPositionSize > 0 && order.sizeDelta < ctx.minPositionSize) revert PositionTooSmall();
        if (m.maxPositionSize > 0 && internalSize > uint256(m.maxPositionSize)) revert ExceedsMaxPositionSize();
        {
            uint256 newOI = order.isLong ? m.totalLongSize + internalSize : m.totalShortSize + internalSize;
            if (m.maxTotalExposure > 0 && newOI > uint256(m.maxTotalExposure)) {
                revert ExceedsMaxTotalExposure();
            }
        }
        if (
            ctx.maxUserExposure > 0 &&
            userExposure[order.account] + order.sizeDelta > ctx.maxUserExposure
        ) revert ExceedsMaxTotalExposure();
        if (
            ctx.userDailyVolumeLimit > 0 &&
            ctx.globalDailyVolumeLimit > 0 &&
            !checkVolumeLimit(
                userDailyVolume,
                globalDailyVolume,
                order.account,
                order.sizeDelta,
                ctx.userDailyVolumeLimit,
                ctx.globalDailyVolumeLimit
            )
        ) revert RateLimitExceededOpen();
        // ----------------------------------------------------------------------------

        uint256 currentPrice = ctx.currentPrice;
        if (currentPrice == 0) revert InvalidOraclePrice();

        // refuse to open against an empty/insufficient TWAP buffer (and: tighten window check).
        (uint256 twapPrice, bool twapValid) = IOracleAggregator(ctx.oracleAggregator).getTWAPWithValidation(
            order.market,
            TWAP_WINDOW_SECONDS,
            DataTypes.MIN_TWAP_DATA_POINTS
        );
        if (!twapValid) revert OpenPriceDeviation();
        if (twapPrice > 0) {
            uint256 twapDeviation = currentPrice > twapPrice
                ? ((currentPrice - twapPrice) * BPS) / twapPrice
                : ((twapPrice - currentPrice) * BPS) / twapPrice;
            if (twapDeviation > MAX_OPEN_PRICE_DEVIATION_BPS) revert OpenPriceDeviation();
        }

        if (order.triggerPrice > 0 && order.orderType == DataTypes.OrderType.MARKET_INCREASE) {
            uint256 deviation = currentPrice > order.triggerPrice
                ? ((currentPrice - order.triggerPrice) * BPS) / order.triggerPrice
                : ((order.triggerPrice - currentPrice) * BPS) / order.triggerPrice;
            if (deviation > order.maxSlippage) revert SlippageExceeded();
        }

        uint256 openingFee = FeeCalculator.calculateOpeningFee(internalSize, ctx.feeConfig, ctx.referralDiscountBps);

        uint256 totalCollateralInternal;
        if (order.collateralToken != address(0)) {
            totalCollateralInternal = DataTypes.toInternalPrecision(
                CollateralRegistry(ctx.collateralRegistry).getCollateralValue(order.collateralToken, order.collateralDelta, false)
            );
        } else {
            totalCollateralInternal = DataTypes.toInternalPrecision(order.collateralDelta);
        }

        if (totalCollateralInternal <= openingFee) revert InsufficientCollateral();

        uint256 marginInternal = totalCollateralInternal - openingFee;

        uint256 leverage = calculateNewLeverage(internalSize, marginInternal);
        if (leverage > uint256(m.maxLeverage) * PRECISION) revert ExceedsMaxLeverage();

        // defence in depth. Even with valid config, refuse to mint a position that
        // would be liquidatable at entry (currentPrice). `pnl == 0` at entry, so this reduces to
        // `marginInternal >= maintenanceMargin(internalSize, leverage)`.
        {
            uint256 mmAtEntry = PositionMath.calculateDynamicMaintenanceMargin(internalSize, leverage);
            if (marginInternal <= mmAtEntry) revert InsufficientCollateral();
        }

        uint256 borrowInternal = internalSize > marginInternal ? internalSize - marginInternal : 0;
        // Ceil so vault transfer covers repay paths that use toUsdcPrecisionCeil (floor borrow would leave a USDC dust shortfall).
        uint256 borrowAmountUsdc = borrowInternal > 0 ? DataTypes.toUsdcPrecisionCeil(borrowInternal) : 0;
        if (borrowAmountUsdc > 0) {
            if (!IVaultCore(ctx.liquidityVault).borrow(borrowAmountUsdc, order.market, order.isLong)) {
                revert InsufficientLiquidity();
            }
        }

        positionId = nextPosId;

        positions[positionId] = DataTypes.Position({
            size: uint128(internalSize),
            entryPrice: uint128(currentPrice),
            liquidationPrice: uint128(
                PositionMath.calculateLiquidationPrice(currentPrice, leverage, internalSize, order.isLong)
            ),
            stopLossPrice: 0,
            takeProfitPrice: 0,
            lastFundingTime: uint64(block.timestamp),
            openTimestamp: uint40(block.timestamp),
            leverage: _toLeverageU64(leverage),
            flags: DataTypes.packFlags(order.isLong, ctx.defaultCrossMargin),
            collateralType: order.collateralType,
            state: DataTypes.PosStatus.OPEN,
            market: order.market,
            trailingStopBps: 0,
            collateralToken: order.collateralToken
        });

        positionCollateral[positionId] = DataTypes.PositionCollateral({
            amount: marginInternal,
            tokenAddress: order.collateralToken,
            borrowedAmount: borrowInternal
        });

        userExposure[order.account] += order.sizeDelta;
        userPositions[order.account].push(positionId);

        if (order.isLong) {
            m.totalLongSize += internalSize;
            m.totalLongCost += (internalSize * currentPrice) / PRECISION;
        } else {
            m.totalShortSize += internalSize;
            m.totalShortCost += (internalSize * currentPrice) / PRECISION;
        }

        // Record daily volume (best-effort gate already above; this updates tally).
        if (ctx.userDailyVolumeLimit > 0 && ctx.globalDailyVolumeLimit > 0) {
            updateVolume(userDailyVolume, globalDailyVolume, order.account, order.sizeDelta);
        }

        _distributeFees(openingFee, ctx, ctx.feeConfig);
        IPositionToken(ctx.positionToken).mint(order.account, positionId, order.market, order.isLong);

        emit ITradingCore.PositionOpened(
            positionId,
            order.account,
            order.market,
            order.isLong,
            internalSize,
            leverage,
            currentPrice
        );
    }

    function liquidatePosition(
        uint256 positionId,
        LiquidatePositionContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256) storage userExposure,
        DataTypes.ProtocolHealthState storage protocolHealth
    ) external returns (uint256 liquidatorReward) {
        LiquidationLib.LiquidatePositionContext memory liqCtx = LiquidationLib.LiquidatePositionContext(
            ctx.usdc,
            ctx.liquidityVault,
            ctx.oracleAggregator,
            ctx.positionToken,
            ctx.treasury,
            ctx.insuranceFund,
            ctx.tradingCore,
            ctx.collateralRegistry,
            ctx.liquidationTiers,
            ctx.liquidationDeviationBps
        );
        return
            LiquidationLib.liquidatePosition(
                positionId,
                liqCtx,
                positions,
                positionCollateral,
                markets,
                userExposure,
                protocolHealth
            );
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
    ) public returns (int256 realizedPnL) {
        PositionCloseLib.ClosePositionContext memory closeCtx = PositionCloseLib.ClosePositionContext(
            ctx.usdc,
            ctx.liquidityVault,
            ctx.oracleAggregator,
            ctx.positionToken,
            ctx.treasury,
            ctx.insuranceFund,
            ctx.collateralRegistry,
            ctx.feeConfig,
            ctx.referrer,
            ctx.referralDiscountBps,
            ctx.referralRebateBps
        );
        // Capture owner BEFORE close - closePosition may burn the NFT on full close
        address posOwner = IPositionToken(ctx.positionToken).ownerOf(positionId);
        realizedPnL = PositionCloseLib.closePosition(
            positionId,
            closeSize,
            minReceive,
            closeCtx,
            positions,
            positionCollateral,
            markets,
            userExposure,
            protocolHealth
        );

        DataTypes.Position storage position = positions[positionId];
        (uint256 currentPrice, , ) = IOracleAggregator(ctx.oracleAggregator).getPrice(position.market);
        // Mirror the discount used by `PositionCloseLib` so the emitted fee matches what was actually charged.
        uint256 closingFee = FeeCalculator.calculateClosingFee(closeSize, ctx.feeConfig, true, ctx.referralDiscountBps);
        emit ITradingCore.PositionClosed(positionId, posOwner, realizedPnL, currentPrice, closingFee);
    }

    /// @dev Internal-only fetch that returns zero on any unexpected revert so the
    ///      registry is never able to brick a trade. Used by `executeOrderFull`.
    function _safeGetReferral(
        address registry,
        address trader
    ) private view returns (address referrer, uint16 discountBps, uint16 rebateBps) {
        try IReferralRegistry(registry).getTraderReferralData(trader) returns (
            IReferralRegistry.ReferralData memory d
        ) {
            return (d.referrer, d.discountBps, d.rebateBps);
        } catch {
            return (address(0), 0, 0);
        }
    }

    /// @dev Open-side fee distribution. Splits a referral rebate from the
    ///      protocol's share before the LP/insurance/treasury split when a
    ///      referrer is present, otherwise falls back to the original split.
    function _distributeFees(
        uint256 totalFee,
        OpenPositionContext memory ctx,
        DataTypes.FeeConfig memory feeConfig
    ) private {
        (uint256 lpShare, uint256 insuranceShare, uint256 treasuryShare, uint256 rebateShare) = FeeCalculator
            .splitFeesWithRebate(totalFee, feeConfig, ctx.referrer == address(0) ? 0 : ctx.referralRebateBps);

        uint256 lpShareUsdc = DataTypes.toUsdcPrecision(lpShare);
        uint256 insuranceShareUsdc = DataTypes.toUsdcPrecision(insuranceShare);
        uint256 treasuryShareUsdc = DataTypes.toUsdcPrecision(treasuryShare);
        uint256 rebateShareUsdc = DataTypes.toUsdcPrecision(rebateShare);

        if (lpShareUsdc > 0) {
            IERC20(ctx.usdc).safeTransfer(ctx.liquidityVault, lpShareUsdc);
        }
        if (insuranceShareUsdc > 0) {
            IERC20(ctx.usdc).safeTransfer(ctx.insuranceFund, insuranceShareUsdc);
            IVaultCore(ctx.insuranceFund).receiveFees(insuranceShareUsdc);
        }
        if (treasuryShareUsdc > 0) {
            IERC20(ctx.usdc).safeTransfer(ctx.treasury, treasuryShareUsdc);
        }
        if (rebateShareUsdc > 0 && ctx.referrer != address(0)) {
            // Rebate USDC stays in the vault; `accrueRebate` records the
            // referrer's claim and isolates the funds from LP accounting.
            IERC20(ctx.usdc).safeTransfer(ctx.liquidityVault, rebateShareUsdc);
            IVaultCore(ctx.liquidityVault).accrueRebate(ctx.referrer, rebateShareUsdc);
        }

        emit FeesDistributed(lpShare, insuranceShare, treasuryShare);
    }

    function closePositionWrapper(
        DataTypes.ClosePositionParams memory p,
        ClosePositionContext memory ctx,
        uint256 minPositionDuration,
        address msgSender,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256) storage userExposure,
        DataTypes.ProtocolHealthState storage protocolHealth
    ) external returns (int256) {
        DataTypes.Position storage pos = positions[p.positionId];
        if (pos.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();

        try IPositionToken(ctx.positionToken).ownerOf(p.positionId) returns (address owner) {
            if (owner != msgSender) revert NotPositionOwner();
        } catch {
            revert PositionNotFound();
        }

        if (block.timestamp < pos.openTimestamp + minPositionDuration) revert MinPositionDuration();

        return
            closePosition(
                p.positionId,
                p.closeSize == 0 ? uint256(pos.size) : p.closeSize,
                p.minReceive,
                ctx,
                positions,
                positionCollateral,
                markets,
                userExposure,
                protocolHealth
            );
    }

    function recordFailedRepayment(
        uint256 positionId,
        uint256 amount,
        address market,
        bool isLong,
        int256 pnl,
        mapping(uint256 => DataTypes.FailedRepayment) storage failedRepayments,
        uint256[] storage failedRepaymentIds,
        mapping(uint256 => uint256) storage failedRepaymentIndex
    ) public {
        if (failedRepayments[positionId].amount > 0 && !failedRepayments[positionId].resolved) {
            return;
        }
        failedRepayments[positionId] = DataTypes.FailedRepayment({
            amount: amount,
            market: market,
            isLong: isLong,
            pnl: pnl,
            timestamp: block.timestamp,
            resolved: false
        });
        failedRepaymentIds.push(positionId);
        failedRepaymentIndex[positionId] = failedRepaymentIds.length - 1;

        emit FailedRepaymentRecorded(positionId, amount, market, isLong, pnl);
    }

    function resolveFailedRepayment(
        uint256 positionId,
        address msgSender,
        address self,
        IERC20 usdcToken,
        IVaultCore vaultCore,
        mapping(uint256 => DataTypes.FailedRepayment) storage failedRepayments
    ) public {
        DataTypes.FailedRepayment storage fr = failedRepayments[positionId];
        if (fr.amount == 0 || fr.resolved) revert InvalidOrResolvedFailedRepayment();

        uint256 balance = usdcToken.balanceOf(self);
        uint256 needFromSender = balance >= fr.amount ? 0 : fr.amount - balance;
        if (needFromSender > 0) {
            usdcToken.safeTransferFrom(msgSender, self, needFromSender);
        }

        usdcToken.forceApprove(address(vaultCore), fr.amount);

        try vaultCore.repay(fr.amount, fr.market, fr.isLong, fr.pnl) {
            usdcToken.forceApprove(address(vaultCore), 0);
            fr.resolved = true;
            emit FailedRepaymentResolved(positionId, fr.amount, msgSender);
        } catch {
            usdcToken.forceApprove(address(vaultCore), 0);
            if (needFromSender > 0) {
                usdcToken.safeTransfer(msgSender, needFromSender);
            }
            revert RepaymentValidationFailed();
        }
    }

    function resolveFailedRepaymentFull(
        uint256 positionId,
        address msgSender,
        address self,
        IERC20 usdcToken,
        IVaultCore vaultCoreContract,
        mapping(uint256 => DataTypes.FailedRepayment) storage failedRepayments,
        uint256[] storage failedRepaymentIds,
        mapping(uint256 => uint256) storage failedRepaymentIndex,
        DataTypes.ProtocolHealthState storage protocolHealth,
        uint256 totalFailedRepayments
    ) external returns (uint256) {
        uint256 amountBefore = failedRepayments[positionId].amount;
        resolveFailedRepayment(positionId, msgSender, self, usdcToken, vaultCoreContract, failedRepayments);
        uint256 len = failedRepaymentIds.length;
        if (len > 0) {
            uint256 idx = failedRepaymentIndex[positionId];
            if (idx < len && failedRepaymentIds[idx] == positionId) {
                uint256 lastId = failedRepaymentIds[len - 1];
                failedRepaymentIds[idx] = lastId;
                failedRepaymentIds.pop();
                failedRepaymentIndex[lastId] = idx;
                delete failedRepaymentIndex[positionId];
            }
        }
        if (amountBefore > 0) {
            uint256 debt = DataTypes.toInternalPrecision(amountBefore);
            protocolHealth.totalBadDebt = protocolHealth.totalBadDebt > debt ? protocolHealth.totalBadDebt - debt : 0;
        }
        return totalFailedRepayments - 1;
    }

    event OrderCancelled(uint256 indexed orderId, string reason);
    event StopLossTakeProfitExecuted(uint256 indexed positionId, uint256 executionPrice, string reason);

    function cancelOrder(
        uint256 orderId,
        address msgSender,
        IERC20,
        mapping(uint256 => DataTypes.Order) storage orders,
        mapping(address => uint256) storage orderRefundBalance,
        mapping(address => uint256) storage orderCollateralRefundBalance
    ) external {
        DataTypes.Order memory order = orders[orderId];
        if (order.account == address(0) || order.timestamp == 0) revert OrderNotFound();
        if (order.account != msgSender) revert Unauthorized();

        delete orders[orderId];

        if (
            (order.orderType == DataTypes.OrderType.MARKET_INCREASE ||
                order.orderType == DataTypes.OrderType.LIMIT_INCREASE) && order.collateralDelta > 0
        ) {
            orderCollateralRefundBalance[order.account] += order.collateralDelta;
        }

        if (order.executionFee > 0) {
            orderRefundBalance[msgSender] += order.executionFee;
        }

        emit OrderCancelled(orderId, "User Cancelled");
    }

    function executeStopLossTakeProfit(
        uint256[] calldata positionIds,
        ClosePositionContext memory ctx,
        address oracleAggregator,
        address referralRegistry_,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => uint256) storage userExposure,
        mapping(address => DataTypes.FundingState) storage fundingStates,
        mapping(uint256 => int256) storage positionCumulativeFunding,
        mapping(uint256 => uint256) storage positionDividendIndex,
        mapping(address => string) storage marketIds,
        IDividendManager dividendManager,
        DataTypes.ProtocolHealthState storage protocolHealth,
        address marketCalendar,
        mapping(uint256 => uint256) storage trailingAnchorPrices
    ) external returns (uint256 executedCount) {
        for (uint256 i = 0; i < positionIds.length; ) {
            uint256 id = positionIds[i];
            DataTypes.Position storage pos = positions[id];
            if (pos.state == DataTypes.PosStatus.OPEN) {
                // skip positions in closed markets so we never trigger SL/TP on stale price.
                bool sessionOpen = true;
                if (marketCalendar != address(0)) {
                    string memory mIdSession = marketIds[pos.market];
                    if (bytes(mIdSession).length > 0) {
                        sessionOpen = IMarketCalendar(marketCalendar).isMarketOpen(mIdSession);
                    }
                }
                if (!sessionOpen) {
                    unchecked { ++i; }
                    continue;
                }

                (uint256 price, , ) = IOracleAggregator(oracleAggregator).getPrice(pos.market);

                // validate price against TWAP before triggering; skip when buffer is cold or deviation excessive.
                {
                    (uint256 twapPrice, bool twapValid) = IOracleAggregator(oracleAggregator).getTWAPWithValidation(
                        pos.market,
                        TWAP_WINDOW_SECONDS,
                        DataTypes.MIN_TWAP_DATA_POINTS
                    );
                    if (!twapValid) {
                        unchecked {
                            ++i;
                        }
                        continue;
                    }
                    if (twapPrice > 0) {
                        uint256 dev = price > twapPrice
                            ? ((price - twapPrice) * BPS) / twapPrice
                            : ((twapPrice - price) * BPS) / twapPrice;
                        if (dev > MAX_LIQUIDATION_PRICE_DEVIATION_BPS) {
                            unchecked {
                                ++i;
                            }
                            continue;
                        }
                    }
                }

                bool isLong = DataTypes.isLong(pos.flags);
                bool triggerClose;
                string memory triggerReason;
                if (pos.trailingStopBps > 0) {
                    uint256 anchor = trailingAnchorPrices[id];
                    if (anchor == 0) anchor = uint256(pos.entryPrice);
                    anchor = PositionMath.updateTrailingAnchor(isLong, price, anchor);
                    trailingAnchorPrices[id] = anchor;
                    if (PositionMath.shouldTriggerTrailingStop(pos, price, anchor)) {
                        triggerClose = true;
                        triggerReason = "TrailingStop";
                    }
                }
                if (!triggerClose) {
                    if (PositionMath.shouldTriggerStopLoss(pos, price)) {
                        triggerClose = true;
                        triggerReason = "StopLoss";
                    } else if (PositionMath.shouldTriggerTakeProfit(pos, price)) {
                        triggerClose = true;
                        triggerReason = "TakeProfit";
                    }
                }

                if (triggerClose) {
                    FundingLib.settlePositionFunding(
                        id,
                        oracleAggregator,
                        positions,
                        positionCollateral,
                        fundingStates,
                        positionCumulativeFunding
                    );
                    if (address(dividendManager) != address(0)) {
                        string memory mId = marketIds[pos.market];
                        if (bytes(mId).length > 0) {
                            (int256 divAmount, uint256 newIndex) = DividendSettlementLib.settleDividends(
                                id,
                                pos,
                                mId,
                                positionDividendIndex[id],
                                dividendManager
                            );
                            if (newIndex > positionDividendIndex[id]) {
                                positionDividendIndex[id] = newIndex;
                                if (divAmount != 0) applyFundingToCollateral(positionCollateral[id], -divAmount, id);
                            }
                        }
                    }
                    // Resolve per-position referral data so a multi-trader batch
                    // applies the correct discount/rebate per close. Cheap when
                    // the position is unreferred (single zero-read off the registry).
                    if (referralRegistry_ != address(0)) {
                        address posOwner = IPositionToken(ctx.positionToken).ownerOf(id);
                        (ctx.referrer, ctx.referralDiscountBps, ctx.referralRebateBps) = _safeGetReferral(
                            referralRegistry_,
                            posOwner
                        );
                    }
                    closePosition(
                        id,
                        uint256(pos.size),
                        0,
                        ctx,
                        positions,
                        positionCollateral,
                        markets,
                        userExposure,
                        protocolHealth
                    );
                    delete trailingAnchorPrices[id];
                    emit StopLossTakeProfitExecuted(id, price, triggerReason);
                    unchecked {
                        ++executedCount;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function applyLiquidatePostProcess(
        uint256 positionId,
        bool didRecordFailed,
        DataTypes.ProtocolHealthState storage protocolHealth,
        mapping(uint256 => DataTypes.FailedRepayment) storage failedRepayments,
        uint256 totalFailedRepayments
    ) external returns (uint256) {
        if (didRecordFailed && failedRepayments[positionId].amount != 0) {
            protocolHealth.totalBadDebt += DataTypes.toInternalPrecision(failedRepayments[positionId].amount);
            return totalFailedRepayments + 1;
        }
        return totalFailedRepayments;
    }
}
