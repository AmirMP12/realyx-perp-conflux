// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/MonitoringLib.sol";
import "../libraries/RateLimitLib.sol";
import "../libraries/GlobalPnLLib.sol";
import "../libraries/CircuitBreakerLib.sol";
import "../libraries/OracleAggregatorLib.sol";
import "../libraries/TradingLib.sol";
import "../libraries/DataTypes.sol";
import "../interfaces/IVaultCore.sol";
import "../interfaces/IOracleAggregator.sol";
import "../libraries/WithdrawLib.sol";
import "../libraries/CleanupLib.sol";
import "../libraries/DustLib.sol";
import "../libraries/FlashLoanCheck.sol";
import "../libraries/ConfigLib.sol";
import "../libraries/FeeCalculator.sol";
import "../libraries/FundingLib.sol";

contract CoverageHarness {
    error ZeroAddress();
    error TransferToContractNotAllowed();
    error PositionNotFound();
    error ExceedsMaxTotalExposure();
    error InsufficientCollateral();
    error ExceedsMaxLeverage();

    DataTypes.ProtocolHealthState public protocolHealth;
    mapping(address => DataTypes.Market) public markets;
    address[] public activeMarkets;
    mapping(address => uint256) public lastLargeActionTime;

    DataTypes.Position public position;
    mapping(uint256 => DataTypes.Position) public positions;
    DataTypes.PositionCollateral public positionCollateral;
    mapping(uint256 => DataTypes.PositionCollateral) public positionCollaterals;
    address public boosterOracleAggregator;
    uint256 public boosterMaxOracleUncertainty;

    function setPosition(uint256 id, DataTypes.Position calldata p) external {
        positions[id] = p;
    }

    function setPositionCollateral(uint256 id, DataTypes.PositionCollateral calldata c) external {
        positionCollaterals[id] = c;
    }

    function boostCalculatePnL(
        uint256 size,
        uint256 entryPrice,
        uint256 currentPrice,
        bool isLong
    ) external pure returns (int256) {
        return PositionMath.calculateUnrealizedPnL(size, entryPrice, currentPrice, isLong);
    }

    function boostShouldTriggerSL(DataTypes.Position calldata p, uint256 currentPrice) external pure returns (bool) {
        return PositionMath.shouldTriggerStopLoss(p, currentPrice);
    }

    function boostShouldTriggerTP(DataTypes.Position calldata p, uint256 currentPrice) external pure returns (bool) {
        return PositionMath.shouldTriggerTakeProfit(p, currentPrice);
    }

    function boostCalculateTradingFee(
        uint256 size,
        DataTypes.FeeConfig calldata config,
        bool isMaker,
        uint256 referralDiscountBps
    ) external pure returns (uint256) {
        return FeeCalculator.calculateTradingFee(size, config, isMaker, referralDiscountBps);
    }

    function boostCalculateFundingRate(
        uint256 longOpenInterest,
        uint256 shortOpenInterest,
        uint256 baseFundingRate
    ) external pure returns (int256) {
        return PositionMath.calculateFundingRate(longOpenInterest, shortOpenInterest, baseFundingRate);
    }

    function boostCalculateLiquidationFee(
        uint256 size,
        uint256 healthFactor,
        DataTypes.LiquidationFeeTiers calldata tiers
    ) external pure returns (uint256) {
        return PositionMath.calculateLiquidationFee(size, healthFactor, tiers);
    }

    function boostValidateSlippage(
        uint256 expected,
        uint256 actual,
        uint256 slippageBps,
        bool isLong
    ) external pure returns (bool) {
        return PositionMath.validateSlippage(expected, actual, slippageBps, isLong);
    }

    function boostCalculateFundingOwed(
        DataTypes.Position calldata p,
        int256 cumulativeFundingDelta
    ) external pure returns (int256) {
        return PositionMath.calculateFundingOwed(p, cumulativeFundingDelta);
    }

    function boostCalculateFundingIntervals(
        uint64 lastSettlement,
        uint256 currentTime,
        uint256 intervalSeconds
    ) external pure returns (uint256) {
        return PositionMath.calculateFundingIntervals(lastSettlement, currentTime, intervalSeconds);
    }

    function boostCheckVolumeLimit(
        address user,
        uint256 size,
        uint256 userLimit,
        uint256 globalLimit
    ) external view returns (bool) {
        return TradingLib.checkVolumeLimit(_userDailyVolume, _globalDailyVolume, user, size, userLimit, globalLimit);
    }

    mapping(address => mapping(uint256 => uint256)) private _userDailyVolume;
    mapping(uint256 => uint256) private _globalDailyVolume;

    function boostCheckMarketOpen(address market, address calendar) external view returns (bool) {
        return TradingLib.checkMarketOpen(market, IMarketCalendar(calendar), marketIds);
    }

    // WithdrawLib State
    mapping(address => uint256) public keeperFeeBalance;
    mapping(address => uint256) public orderRefundBalance;
    mapping(address => uint256) public orderCollateralRefundBalance;

    // CleanupLib State
    uint256[] public cleanupUserPositions;

    function boostCalculateInitialMargin(uint256 size, uint64 leverage) external pure returns (uint256) {
        return PositionMath.calculateInitialMargin(size, leverage);
    }

    function boostCalculateMaintenanceMargin(uint256 size, uint16 maintenanceMargin) external pure returns (uint256) {
        return PositionMath.calculateMaintenanceMargin(size, maintenanceMargin);
    }

    function boostCalculateDynamicMM(uint256 size, uint256 leverage) external pure returns (uint256) {
        return PositionMath.calculateDynamicMaintenanceMargin(size, leverage);
    }

    function boostCalculateLiquidationPrice(
        uint256 entry,
        uint256 leverage,
        uint256 mmBps,
        bool isLong
    ) external pure returns (uint256) {
        return PositionMath.calculateLiquidationPrice(entry, leverage, mmBps, isLong);
    }

    function boostCalculateNewLeverage(uint256 size, uint256 collateral) external pure returns (uint256) {
        return TradingLib.calculateNewLeverage(size, collateral);
    }

    function boostValidateOpeningPrice(
        uint256 current,
        uint256 expected,
        uint256 slippage
    ) external pure returns (bool) {
        uint256 diff = current > expected ? current - expected : expected - current;
        if (expected == 0) return false;
        if ((diff * 10000) / expected > slippage) return false;
        return true;
    }

    // DustLib State
    DataTypes.DustAccumulator public dustAccumulator;

    // FlashLoanCheck State
    mapping(address => uint256) public lastInteractionBlock;
    mapping(address => bool) public trustedForwarders;

    function boostCalculateRealizedPnL(
        int256 unrealizedPnL,
        uint256 tradingFee,
        int256 fundingOwed
    ) external pure returns (int256) {
        return PositionMath.calculateRealizedPnL(unrealizedPnL, tradingFee, fundingOwed);
    }

    // VaultCore boosters
    uint256 public totalBorrowed;
    int256 public pendingPnL;
    uint256 public accumulatedFees;
    uint256 public lpTotalShares;
    uint256 public insTotalShares;

    function boostDistributeSurplus(
        uint256 fedAmt,
        uint256 protocolTVL,
        uint256 treasuryShareBps
    ) external pure returns (uint256 lpShare, uint256 insShare, uint256 treasuryShare) {
        // We'll mimic the logic since it's an internal function in VaultCore
        uint256 surplus = fedAmt;
        if (protocolTVL > 0) {
            treasuryShare = (surplus * treasuryShareBps) / 10000;
            surplus -= treasuryShare;
            // ... and so on. Better yet, we'll try to trigger it in the actual VaultCore
        }
        return (0, 0, 0); // Simplified for now since VaultCore is not a library
    }
    uint256 public lastGlobalInteractionBlock;
    uint256 public globalBlockInteractions;
    mapping(address => uint256) public lastInteractionTimestamp;

    // ConfigLib State
    mapping(address => DataTypes.Market) public configMarkets;
    mapping(address => bool) public isMarketActive;
    mapping(address => DataTypes.FundingState) public fundingStates;
    mapping(uint256 => int256) public positionCumulativeFunding;
    mapping(address => uint256[]) private _userPositionList;

    // --- TradingLib Deep Boosters ---
    function boostCancelOrder(
        uint256 orderId,
        address user,
        address msgSender,
        uint256 collateralDelta,
        uint8 orderType,
        uint256 executionFee
    ) external {
        DataTypes.Order storage order = _harnessOrders[orderId];
        order.account = user;
        order.timestamp = block.timestamp;
        order.collateralDelta = collateralDelta;
        order.orderType = DataTypes.OrderType(orderType);
        order.executionFee = executionFee;

        TradingLib.cancelOrder(
            orderId,
            msgSender,
            IERC20(address(0)),
            _harnessOrders,
            orderRefundBalance,
            orderCollateralRefundBalance
        );
    }
    mapping(uint256 => DataTypes.Order) private _harnessOrders;

    function boostApplyLiquidatePostProcess(
        uint256 positionId,
        bool didRecordFailed,
        uint256 totalBadDebt,
        uint256 failedAmount,
        uint256 totalFailedRepayments
    ) external returns (uint256, uint256) {
        DataTypes.ProtocolHealthState storage health = _harnessHealth;
        health.totalBadDebt = totalBadDebt;
        _harnessFailedRepayments[positionId].amount = failedAmount;

        uint256 newTotal = TradingLib.applyLiquidatePostProcess(
            positionId,
            didRecordFailed,
            health,
            _harnessFailedRepayments,
            totalFailedRepayments
        );
        return (newTotal, health.totalBadDebt);
    }
    DataTypes.ProtocolHealthState private _harnessHealth;
    mapping(uint256 => DataTypes.FailedRepayment) private _harnessFailedRepayments;

    // --- VaultCore Deep Boosters ---
    function boostProcessWithdrawal(
        uint256 requestId,
        uint256 shares,
        address user,
        uint256 requestTime,
        uint256 minAssets,
        uint256,
        uint256,
        uint256
    ) external returns (bool processed, uint256 finalLpShares, uint256 finalLpAssets, uint256 finalReserved) {
        _harnessWithdrawalRequests[requestId] = DataTypes.WithdrawalRequest({
            user: user,
            shares: shares,
            requestTime: uint64(requestTime),
            minAssets: minAssets,
            processed: false
        });

        // Setup internal state for conversion logic (VaultCore uses _convertToLPAssets)
        // Since we can't easily override VaultCore internal, we'll emulate the slippage/revert branches
        // Or just trigger it via the real VaultCore by setting its state
        return (false, 0, 0, 0);
    }
    mapping(uint256 => DataTypes.WithdrawalRequest) private _harnessWithdrawalRequests;
    address[] public activeMarketsList;

    // Circuit Breaker State
    mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) public breakerConfigs;
    mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) public breakerStatuses;
    mapping(address => mapping(uint256 => uint256)) public historicalPrices;

    // Oracle Aggregator State
    DataTypes.PricePoint[48] public pricePoints;
    uint256 public head;
    uint256 public count;

    // TradingLib State
    mapping(address => mapping(uint256 => uint256)) public userDailyVolume;
    mapping(uint256 => uint256) public globalDailyVolume;
    uint256[] public allPositionIds;
    mapping(address => uint256) public userExposure;

    function testGetProtocolHealth(
        IVaultCore vaultCore,
        IOracleAggregator oracleAggregator
    ) external view returns (bool, uint256, uint256, uint256, uint256, int256) {
        return
            MonitoringLib.getProtocolHealth(
                protocolHealth,
                address(vaultCore),
                activeMarkets,
                markets,
                address(oracleAggregator)
            );
    }

    function testGetPositionHealth(
        IOracleAggregator oracleAggregator
    ) external view returns (bool, uint256, int256, uint256, bool, bool) {
        return MonitoringLib.getPositionHealth(position, positionCollateral, address(oracleAggregator));
    }

    function testGlobalPnL(IOracleAggregator oracleAggregator) external view returns (int256) {
        return GlobalPnLLib.getGlobalUnrealizedPnL(activeMarkets, markets, address(oracleAggregator));
    }

    function testRateLimit(uint256 size, uint256 threshold, uint256 interval) external {
        RateLimitLib.checkAndUpdate(size, threshold, interval, block.timestamp, lastLargeActionTime);
    }

    // CircuitBreakerLib Wrappers
    function testConfigureBreaker(
        address collection,
        DataTypes.BreakerType bType,
        uint256 threshold,
        uint256 window,
        uint256 cooldown
    ) external {
        CircuitBreakerLib.configureBreaker(collection, bType, threshold, window, cooldown, breakerConfigs);
    }

    function testTriggerBreaker(address collection, DataTypes.BreakerType bType) external {
        CircuitBreakerLib.triggerBreaker(collection, bType, breakerConfigs, breakerStatuses);
    }

    function testResetBreaker(address collection, DataTypes.BreakerType bType, bool isAdmin) external {
        CircuitBreakerLib.resetBreaker(collection, bType, isAdmin, breakerStatuses);
    }

    function testIsActionAllowed(address collection, uint8 actionType, bool globalPause) external view returns (bool) {
        return CircuitBreakerLib.isActionAllowed(collection, actionType, globalPause, breakerStatuses);
    }

    function testCheckPriceDropBreaker(address collection, uint256 currentPrice) external returns (bool) {
        return
            CircuitBreakerLib.checkPriceDropBreaker(
                collection,
                currentPrice,
                breakerConfigs,
                breakerStatuses,
                historicalPrices
            );
    }

    function testCheckTWAPDeviationBreaker(
        address collection,
        uint256 currentPrice,
        uint256 twap
    ) external returns (bool) {
        return
            CircuitBreakerLib.checkTWAPDeviationBreaker(
                collection,
                currentPrice,
                twap,
                breakerConfigs,
                breakerStatuses
            );
    }

    // OracleAggregatorLib Wrappers
    function testCalculateTWAP(uint256 windowSeconds) external view returns (uint256) {
        return OracleAggregatorLib.calculateTWAP(pricePoints, head, count, windowSeconds, block.timestamp);
    }

    function testCalculateTWAPWithCount(uint256 windowSeconds) external view returns (uint256, uint256) {
        return OracleAggregatorLib.calculateTWAPWithCount(pricePoints, head, count, windowSeconds, block.timestamp);
    }

    function testCalculateSimpleTWAPFromBuffer() external view returns (uint256) {
        return OracleAggregatorLib.calculateSimpleTWAP(pricePoints, head, count);
    }

    function testComputeAggregatedPrice(
        uint256[] calldata prices,
        uint256[] calldata weights,
        uint256 maxDev
    ) external pure returns (uint256, uint256, uint256) {
        return OracleAggregatorLib.computeAggregatedPrice(prices, weights, maxDev);
    }

    function testCalculateDeviation(uint256 a, uint256 b) external pure returns (uint256) {
        return OracleAggregatorLib.calculateDeviation(a, b);
    }

    function testNormalizeChainlinkPrice(int256 answer, uint8 decimals) external pure returns (uint256) {
        return OracleAggregatorLib.normalizeChainlinkPrice(answer, decimals);
    }

    function testCheckVolumeSpike(
        uint256 vol24h,
        uint256 avgVol,
        uint256 threshold
    ) external pure returns (bool, uint256) {
        return OracleAggregatorLib.checkVolumeSpikeTriggered(vol24h, avgVol, threshold);
    }

    // Setters
    function setProtocolHealth(bool isHealthy, uint256 totalBadDebt, uint64 lastHealthCheck) external {
        protocolHealth.isHealthy = isHealthy;
        protocolHealth.totalBadDebt = totalBadDebt;
        protocolHealth.lastHealthCheck = lastHealthCheck;
    }

    function testUpdateProtocolHealth(uint256 totalAssets) external {
        protocolHealth.isHealthy = totalAssets > 0
            ? protocolHealth.totalBadDebt <= (totalAssets * DataTypes.MAX_BAD_DEBT_RATIO_BPS) / 10000
            : true;
        protocolHealth.lastHealthCheck = uint64(block.timestamp);
    }

    function setPosition(
        uint256 id,
        uint128 size,
        uint128 entryPrice,
        uint8 flags,
        DataTypes.PosStatus state,
        address market
    ) external {
        DataTypes.Position memory p = DataTypes.Position({
            size: size,
            entryPrice: entryPrice,
            liquidationPrice: 0,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            leverage: 20,
            lastFundingTime: 0,
            market: market,
            openTimestamp: uint40(block.timestamp),
            trailingStopBps: 0,
            flags: flags,
            collateralType: DataTypes.CollateralType.USDC,
            state: state
        });
        position = p;
        positions[id] = p;
    }

    function setCollateral(uint256 id, uint256 amount) external {
        DataTypes.PositionCollateral memory c = DataTypes.PositionCollateral({
            amount: amount,
            tokenAddress: address(0)
        });
        positionCollateral = c;
        positionCollaterals[id] = c;
    }

    function addMarket(address market) external {
        activeMarkets.push(market);
        markets[market].isActive = true;
        markets[market].isListed = true;
        markets[market].totalLongSize = 1000e18;
        markets[market].totalLongCost = 1000e18;
    }

    function setMarketExposure(
        address market,
        bool isActive,
        uint256 totalLongSize,
        uint256 totalLongCost,
        uint256 totalShortSize,
        uint256 totalShortCost
    ) external {
        markets[market].isActive = isActive;
        markets[market].totalLongSize = totalLongSize;
        markets[market].totalLongCost = totalLongCost;
        markets[market].totalShortSize = totalShortSize;
        markets[market].totalShortCost = totalShortCost;
    }

    function setHistoricalPrice(address collection, uint256 bucket, uint256 price) external {
        historicalPrices[collection][bucket] = price;
    }

    function addPricePoint(uint128 price, uint64 confidence, uint64 timestamp) external {
        pricePoints[head] = DataTypes.PricePoint({price: price, confidence: confidence, timestamp: timestamp});
        head = (head + 1) % 48;
        if (count < 48) count++;
    }

    function testCalculateWeightedAverage(
        uint256[] memory values,
        uint256[] memory weights
    ) external pure returns (uint256) {
        return OracleAggregatorLib.calculateWeightedAverage(values, weights);
    }

    function testCheckPriceDropTriggered(
        uint256 current,
        uint256 past,
        uint256 threshold
    ) external pure returns (bool triggered, uint256 dropBps) {
        return OracleAggregatorLib.checkPriceDropTriggered(current, past, threshold);
    }

    function testCheckTWAPDeviationTriggered(
        uint256 current,
        uint256 twap,
        uint256 threshold
    ) external pure returns (bool triggered, uint256 deviation) {
        return OracleAggregatorLib.checkTWAPDeviationTriggered(current, twap, threshold);
    }

    function testCheckVolumeSpikeTriggered(
        uint256 volume,
        uint256 avg,
        uint256 threshold
    ) external pure returns (bool triggered, uint256 multiplier) {
        return OracleAggregatorLib.checkVolumeSpikeTriggered(volume, avg, threshold);
    }

    function testCheckVolumeLimit(
        address user,
        uint256 size,
        uint256 userLimit,
        uint256 globalLimit
    ) external view returns (bool) {
        return TradingLib.checkVolumeLimit(userDailyVolume, globalDailyVolume, user, size, userLimit, globalLimit);
    }

    function testUpdateVolume(address user, uint256 size) external {
        TradingLib.updateVolume(userDailyVolume, globalDailyVolume, user, size);
    }

    function testGetUserPositionsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory positionIds, uint256 total) {
        return TradingLib.getUserPositionsPaginated(allPositionIds, offset, limit);
    }

    function testGetActivePositions() external view returns (uint256[] memory positionIds) {
        return TradingLib.getActivePositions(allPositionIds, positions);
    }

    function addPositionId(uint256 id) external {
        allPositionIds.push(id);
    }

    function testUpdatePositionOwner(
        uint256 positionId,
        address newOwner,
        address oldOwner,
        uint256 maxUserExposure
    ) external {
        TradingLib.updatePositionOwner(positionId, newOwner, oldOwner, maxUserExposure, positions, userExposure);
    }

    function testAddCollateral(
        uint256 positionId,
        uint256 amount,
        uint256 maxLeverage,
        bool isEmergency,
        address usdc,
        address oracleAggregator,
        uint256 maxOracleUncertainty
    ) external {
        TradingLib.CollateralContext memory ctx = TradingLib.CollateralContext({
            usdc: usdc,
            oracleAggregator: oracleAggregator,
            maxOracleUncertainty: maxOracleUncertainty
        });
        TradingLib.addCollateral(
            positionId,
            amount,
            maxLeverage,
            isEmergency,
            ctx,
            positions,
            positionCollaterals,
            configMarkets
        );
    }

    function testWithdrawCollateral(
        uint256 positionId,
        uint256 amount,
        address usdc,
        address oracleAggregator,
        uint256 maxOracleUncertainty
    ) external {
        TradingLib.CollateralContext memory ctx = TradingLib.CollateralContext({
            usdc: usdc,
            oracleAggregator: oracleAggregator,
            maxOracleUncertainty: maxOracleUncertainty
        });
        TradingLib.withdrawCollateral(positionId, amount, ctx, positions, positionCollaterals, configMarkets);
    }

    function testCheckMarketOpen(address market, address calendar) external view returns (bool) {
        return TradingLib.checkMarketOpen(market, IMarketCalendar(calendar), marketIds);
    }

    mapping(address => string) public marketIds;

    function setMarketId(address market, string calldata mId) external {
        marketIds[market] = mId;
    }

    function testGetPositionPnL(
        uint256 id,
        uint256 currentPrice
    ) external view returns (int256 pnl, uint256 healthFactor) {
        return TradingLib.getPositionPnL(positions[id], positionCollaterals[id], currentPrice);
    }

    function testCanLiquidate(
        uint256 id,
        uint256 currentPrice
    ) external view returns (bool liquidatable, uint256 healthFactor) {
        return TradingLib.canLiquidate(positions[id], positionCollaterals[id], currentPrice);
    }

    function setFundingState(
        address market,
        int256 fundingRate,
        int256 cumulativeFunding,
        uint64 lastSettlement,
        uint256 longOpenInterest,
        uint256 shortOpenInterest
    ) external {
        fundingStates[market] = DataTypes.FundingState({
            fundingRate: fundingRate,
            cumulativeFunding: cumulativeFunding,
            lastSettlement: lastSettlement,
            longOpenInterest: longOpenInterest,
            shortOpenInterest: shortOpenInterest
        });
    }

    function setPositionCumulativeFunding(uint256 id, int256 value) external {
        positionCumulativeFunding[id] = value;
    }

    function testTradingLibSettleFunding(address market) external returns (int256) {
        return TradingLib.settleFunding(fundingStates[market], configMarkets[market], market);
    }

    function testTradingLibSettlePositionFunding(
        uint256 positionId,
        address oracleAggregator
    ) external returns (int256) {
        return
            TradingLib.settlePositionFunding(
                positionId,
                oracleAggregator,
                positions,
                positionCollaterals,
                fundingStates,
                positionCumulativeFunding
            );
    }

    function testTradingLibExecuteOrderInvalidType(uint8 rawOrderType) external returns (uint256) {
        DataTypes.Order memory order = DataTypes.Order({
            id: 0,
            account: msg.sender,
            market: address(0),
            sizeDelta: 0,
            collateralDelta: 0,
            triggerPrice: 0,
            positionId: 0,
            isLong: true,
            orderType: DataTypes.OrderType(rawOrderType),
            timestamp: block.timestamp,
            executionFee: 0,
            maxSlippage: 0
        });

        TradingLib.OpenPositionContext memory ctx = TradingLib.OpenPositionContext({
            market: address(0),
            isLong: true,
            size: 0,
            leverage: 0,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            trailingStopBps: 0,
            maxOracleUncertainty: 0,
            usdc: address(0),
            liquidityVault: address(0),
            oracleAggregator: address(0),
            positionToken: address(0),
            treasury: address(0),
            insuranceFund: address(0),
            feeConfig: DataTypes.FeeConfig({
                makerFeeBps: 0,
                takerFeeBps: 0,
                minFeeUsdc: 0,
                lpShareBps: 0,
                insuranceShareBps: 0,
                treasuryShareBps: 0
            }),
            currentPrice: 0
        });

        return
            TradingLib.executeOrder(
                order,
                ctx,
                positions,
                positionCollaterals,
                configMarkets,
                _userPositionList,
                userExposure,
                1
            );
    }

    function testCalculateNewLeverage(uint256 size, uint256 collateral) external pure returns (uint256) {
        return TradingLib.calculateNewLeverage(size, collateral);
    }

    function testIsLong(uint8 flags) external pure returns (bool) {
        return DataTypes.isLong(flags);
    }

    function testIsCrossMargin(uint8 flags) external pure returns (bool) {
        return DataTypes.isCrossMargin(flags);
    }

    function testToUsdcPrecisionCeil(uint256 internalAmount) external pure returns (uint256) {
        return DataTypes.toUsdcPrecisionCeil(internalAmount);
    }

    function debugCalculatePnL(
        uint256 size,
        uint256 entry,
        uint256 current,
        bool isLong
    ) external pure returns (int256) {
        return PositionMath.calculateUnrealizedPnL(size, entry, current, isLong);
    }

    function testCalculateLiquidationPrice(
        uint256 entry,
        uint256 leverage,
        uint256 mm,
        bool isLong
    ) external pure returns (uint256) {
        return PositionMath.calculateLiquidationPrice(entry, leverage, mm, isLong);
    }

    function testShouldTriggerSL(uint256 id, uint256 currentPrice) external view returns (bool) {
        return PositionMath.shouldTriggerStopLoss(positions[id], currentPrice);
    }

    function testShouldTriggerTP(uint256 id, uint256 currentPrice) external view returns (bool) {
        return PositionMath.shouldTriggerTakeProfit(positions[id], currentPrice);
    }

    function testValidateSlippage(
        uint256 expected,
        uint256 actual,
        uint256 slippage,
        bool isLong
    ) external pure returns (bool) {
        return PositionMath.validateSlippage(expected, actual, slippage, isLong);
    }

    function boostCheckBreakers(
        address oracle,
        address market,
        uint256 currentPrice,
        uint256 twap
    ) external returns (bool) {
        return IOracleAggregator(oracle).checkBreakers(market, currentPrice, twap);
    }

    function boostGetPositionPnL(
        uint256 id,
        uint256 currentPrice
    ) external view returns (int256 pnl, uint256 healthFactor) {
        return TradingLib.getPositionPnL(positions[id], positionCollaterals[id], currentPrice);
    }

    function testOracleIsActionAllowed(
        address oracle,
        address collection,
        uint8 actionType
    ) external view returns (bool) {
        return IOracleAggregator(oracle).isActionAllowed(collection, actionType);
    }

    // WithdrawLib Wrappers
    function testWithdrawKeeperFees(address sender) external {
        WithdrawLib.withdrawKeeperFees(keeperFeeBalance, sender);
    }

    function testWithdrawOrderRefund(address sender) external {
        WithdrawLib.withdrawOrderRefund(orderRefundBalance, sender);
    }

    function testWithdrawOrderCollateralRefund(address sender, IERC20 usdc) external {
        WithdrawLib.withdrawOrderCollateralRefund(orderCollateralRefundBalance, sender, usdc);
    }

    // CleanupLib Wrappers
    function testCleanupPositions(uint256 maxCleanup) external returns (uint256) {
        return CleanupLib.cleanupPositions(cleanupUserPositions, positions, positionCollaterals, maxCleanup);
    }

    function addCleanupPosition(uint256 id) external {
        cleanupUserPositions.push(id);
    }

    // DustLib Wrappers
    function testSweepDust(IERC20 usdc, address treasury) external returns (uint256) {
        return DustLib.sweepDust(usdc, treasury, dustAccumulator);
    }

    function setDust(uint256 amount) external {
        dustAccumulator.totalDust = amount;
    }

    // FlashLoanCheck Wrappers
    function testValidateFlashLoan(
        address sender,
        address origin,
        bool isOperator,
        uint256 maxActionsPerBlock,
        uint256 minInteractionDelay
    ) external {
        (lastGlobalInteractionBlock, globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            sender,
            origin,
            block.number,
            block.timestamp,
            isOperator,
            maxActionsPerBlock,
            minInteractionDelay,
            lastInteractionBlock,
            trustedForwarders,
            lastGlobalInteractionBlock,
            globalBlockInteractions,
            lastInteractionTimestamp
        );
    }

    function testDoubleValidateFlashLoan(
        address sender,
        address origin,
        bool isOperator,
        uint256 maxActionsPerBlock,
        uint256 minInteractionDelay
    ) external {
        (lastGlobalInteractionBlock, globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            sender,
            origin,
            block.number,
            block.timestamp,
            isOperator,
            maxActionsPerBlock,
            minInteractionDelay,
            lastInteractionBlock,
            trustedForwarders,
            lastGlobalInteractionBlock,
            globalBlockInteractions,
            lastInteractionTimestamp
        );
        (lastGlobalInteractionBlock, globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            sender,
            origin,
            block.number,
            block.timestamp,
            isOperator,
            maxActionsPerBlock,
            minInteractionDelay,
            lastInteractionBlock,
            trustedForwarders,
            lastGlobalInteractionBlock,
            globalBlockInteractions,
            lastInteractionTimestamp
        );
    }

    function testDoubleValidateFlashLoanDifferentSenders(
        address senderA,
        address senderB,
        address origin,
        bool isOperator,
        uint256 maxActionsPerBlock,
        uint256 minInteractionDelay
    ) external {
        (lastGlobalInteractionBlock, globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            senderA,
            origin,
            block.number,
            block.timestamp,
            isOperator,
            maxActionsPerBlock,
            minInteractionDelay,
            lastInteractionBlock,
            trustedForwarders,
            lastGlobalInteractionBlock,
            globalBlockInteractions,
            lastInteractionTimestamp
        );
        (lastGlobalInteractionBlock, globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            senderB,
            origin,
            block.number,
            block.timestamp,
            isOperator,
            maxActionsPerBlock,
            minInteractionDelay,
            lastInteractionBlock,
            trustedForwarders,
            lastGlobalInteractionBlock,
            globalBlockInteractions,
            lastInteractionTimestamp
        );
    }

    function setTrustedForwarder(address forwarder, bool trusted) external {
        trustedForwarders[forwarder] = trusted;
    }

    function setLastInteractionBlock(address user, uint256 blockNo) external {
        lastInteractionBlock[user] = blockNo;
    }

    function setLastInteractionTimestamp(address user, uint256 ts) external {
        lastInteractionTimestamp[user] = ts;
    }

    // ConfigLib Wrappers
    function testSetMarket(
        address m,
        address feed,
        uint256 maxLev,
        uint256 maxPos,
        uint256 maxExp,
        uint256 mmBps,
        uint256 imBps,
        uint256 maxStaleness,
        uint256 maxOracleUncertainty
    ) external {
        ConfigLib.setMarket(
            m,
            feed,
            maxLev,
            maxPos,
            maxExp,
            mmBps,
            imBps,
            maxStaleness,
            maxOracleUncertainty,
            configMarkets,
            isMarketActive,
            activeMarketsList,
            20
        );
    }

    function testUpdateMarket(
        address m,
        address feed,
        uint256 maxLev,
        uint256 maxPos,
        uint256 maxExp,
        uint256 mmBps,
        uint256 imBps,
        uint256 maxStaleness,
        uint256 maxOracleUncertainty
    ) external {
        ConfigLib.updateMarket(
            m,
            feed,
            maxLev,
            maxPos,
            maxExp,
            mmBps,
            imBps,
            maxStaleness,
            maxOracleUncertainty,
            configMarkets
        );
    }

    function setUnlistMarket(address m) external {
        ConfigLib.unlistMarket(m, configMarkets, isMarketActive, activeMarketsList);
    }

    /// @dev Test helper to force `ConfigLib.setMarket` into its "already-active" path.
    function corruptIsMarketActive(address m, bool flag) external {
        isMarketActive[m] = flag;
    }

    function setKeeperFeeBalance(address user, uint256 amount) external {
        keeperFeeBalance[user] = amount;
    }

    function setOrderRefundBalance(address user, uint256 amount) external {
        orderRefundBalance[user] = amount;
    }

    function setOrderCollateralRefundBalance(address user, uint256 amount) external {
        orderCollateralRefundBalance[user] = amount;
    }

    receive() external payable {}
}
