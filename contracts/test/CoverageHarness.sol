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

contract CoverageHarness {
    DataTypes.ProtocolHealthState public protocolHealth;
    mapping(address => DataTypes.Market) public markets;
    address[] public activeMarkets;
    mapping(address => uint256) public lastLargeActionTime;
    DataTypes.Position public position;
    mapping(uint256 => DataTypes.Position) public positions;
    DataTypes.PositionCollateral public positionCollateral;
    mapping(uint256 => DataTypes.PositionCollateral) public positionCollaterals; // Additional mapping for TradingLib tests if needed
    
    // WithdrawLib State
    mapping(address => uint256) public keeperFeeBalance;
    mapping(address => uint256) public orderRefundBalance;
    mapping(address => uint256) public orderCollateralRefundBalance;
    
    // CleanupLib State
    uint256[] public cleanupUserPositions;
    
    // DustLib State
    DataTypes.DustAccumulator public dustAccumulator;
    
    // FlashLoanCheck State
    mapping(address => uint256) public lastInteractionBlock;
    mapping(address => bool) public trustedForwarders;
    uint256 public lastGlobalInteractionBlock;
    uint256 public globalBlockInteractions;
    mapping(address => uint256) public lastInteractionTimestamp;

    // ConfigLib State
    mapping(address => DataTypes.Market) public configMarkets;
    mapping(address => bool) public isMarketActive;
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

    function testGetProtocolHealth(IVaultCore vaultCore, IOracleAggregator oracleAggregator) external view returns (bool, uint256, uint256, uint256, uint256, int256) {
        return MonitoringLib.getProtocolHealth(protocolHealth, address(vaultCore), activeMarkets, markets, address(oracleAggregator));
    }

    function testGetPositionHealth(IOracleAggregator oracleAggregator) external view returns (bool, uint256, int256, uint256, bool, bool) {
        return MonitoringLib.getPositionHealth(position, positionCollateral, address(oracleAggregator));
    }

    function testGlobalPnL(IOracleAggregator oracleAggregator) external view returns (int256) {
        return GlobalPnLLib.getGlobalUnrealizedPnL(activeMarkets, markets, address(oracleAggregator));
    }

    function testRateLimit(uint256 size, uint256 threshold, uint256 interval) external {
        RateLimitLib.checkAndUpdate(size, threshold, interval, block.timestamp, lastLargeActionTime);
    }

    // CircuitBreakerLib Wrappers
    function testConfigureBreaker(address collection, DataTypes.BreakerType bType, uint256 threshold, uint256 window, uint256 cooldown) external {
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
        return CircuitBreakerLib.checkPriceDropBreaker(collection, currentPrice, breakerConfigs, breakerStatuses, historicalPrices);
    }

    function testCheckTWAPDeviationBreaker(address collection, uint256 currentPrice, uint256 twap) external returns (bool) {
        return CircuitBreakerLib.checkTWAPDeviationBreaker(collection, currentPrice, twap, breakerConfigs, breakerStatuses);
    }

    // OracleAggregatorLib Wrappers
    function testCalculateTWAP(uint256 windowSeconds) external view returns (uint256) {
        return OracleAggregatorLib.calculateTWAP(pricePoints, head, count, windowSeconds, block.timestamp);
    }

    function testCalculateTWAPWithCount(uint256 windowSeconds) external view returns (uint256, uint256) {
        return OracleAggregatorLib.calculateTWAPWithCount(pricePoints, head, count, windowSeconds, block.timestamp);
    }

    function testComputeAggregatedPrice(uint256[] calldata prices, uint256[] calldata weights, uint256 maxDev) external pure returns (uint256, uint256, uint256) {
        return OracleAggregatorLib.computeAggregatedPrice(prices, weights, maxDev);
    }
    
    function testCalculateDeviation(uint256 a, uint256 b) external pure returns (uint256) {
        return OracleAggregatorLib.calculateDeviation(a, b);
    }

    function testNormalizeChainlinkPrice(int256 answer, uint8 decimals) external pure returns (uint256) {
        return OracleAggregatorLib.normalizeChainlinkPrice(answer, decimals);
    }

    function testCheckVolumeSpike(uint256 vol24h, uint256 avgVol, uint256 threshold) external pure returns (bool, uint256) {
        return OracleAggregatorLib.checkVolumeSpikeTriggered(vol24h, avgVol, threshold);
    }

    // Setters
    function setProtocolHealth(bool isHealthy, uint256 totalBadDebt, uint64 lastHealthCheck) external {
        protocolHealth.isHealthy = isHealthy;
        protocolHealth.totalBadDebt = totalBadDebt;
        protocolHealth.lastHealthCheck = lastHealthCheck;
    }

    function setPosition(uint256 id, uint128 size, uint128 entryPrice, uint8 flags, DataTypes.PosStatus state, address market) external {
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

    function setHistoricalPrice(address collection, uint256 bucket, uint256 price) external {
        historicalPrices[collection][bucket] = price;
    }

    function addPricePoint(uint128 price, uint64 confidence, uint64 timestamp) external {
        pricePoints[head] = DataTypes.PricePoint({
            price: price,
            confidence: confidence,
            timestamp: timestamp
        });
        head = (head + 1) % 48;
        if (count < 48) count++;
    }

    function testCalculateWeightedAverage(uint256[] memory values, uint256[] memory weights) external pure returns (uint256) {
        return OracleAggregatorLib.calculateWeightedAverage(values, weights);
    }

    function testCheckPriceDropTriggered(uint256 current, uint256 past, uint256 threshold) external pure returns (bool triggered, uint256 dropBps) {
        return OracleAggregatorLib.checkPriceDropTriggered(current, past, threshold);
    }

    function testCheckTWAPDeviationTriggered(uint256 current, uint256 twap, uint256 threshold) external pure returns (bool triggered, uint256 deviation) {
        return OracleAggregatorLib.checkTWAPDeviationTriggered(current, twap, threshold);
    }

    function testCheckVolumeSpikeTriggered(uint256 volume, uint256 avg, uint256 threshold) external pure returns (bool triggered, uint256 multiplier) {
        return OracleAggregatorLib.checkVolumeSpikeTriggered(volume, avg, threshold);
    }

    function testCheckVolumeLimit(address user, uint256 size, uint256 userLimit, uint256 globalLimit) external view returns (bool) {
        return TradingLib.checkVolumeLimit(userDailyVolume, globalDailyVolume, user, size, userLimit, globalLimit);
    }

    function testUpdateVolume(address user, uint256 size) external {
        TradingLib.updateVolume(userDailyVolume, globalDailyVolume, user, size);
    }

    function testGetUserPositionsPaginated(uint256 offset, uint256 limit) external view returns (uint256[] memory positionIds, uint256 total) {
        return TradingLib.getUserPositionsPaginated(allPositionIds, offset, limit);
    }

    function testGetActivePositions() external view returns (uint256[] memory positionIds) {
        return TradingLib.getActivePositions(allPositionIds, positions);
    }

    function addPositionId(uint256 id) external {
        allPositionIds.push(id);
    }

    function testUpdatePositionOwner(uint256 positionId, address newOwner, address oldOwner, uint256 maxUserExposure) external {
        TradingLib.updatePositionOwner(positionId, newOwner, oldOwner, maxUserExposure, positions, userExposure);
    }
    
    function testGetPositionPnL(uint256 id, uint256 currentPrice) external view returns (int256 pnl, uint256 healthFactor) {
        return TradingLib.getPositionPnL(positions[id], positionCollaterals[id], currentPrice);
    }
    
    function testCanLiquidate(uint256 id, uint256 currentPrice) external view returns (bool liquidatable, uint256 healthFactor) {
        return TradingLib.canLiquidate(positions[id], positionCollaterals[id], currentPrice);
    }
    
    function testCalculateNewLeverage(uint256 size, uint256 collateral) external pure returns (uint256) {
        return TradingLib.calculateNewLeverage(size, collateral);
    }

    function testIsLong(uint8 flags) external pure returns (bool) {
        return DataTypes.isLong(flags);
    }

    function debugCalculatePnL(uint256 size, uint256 entry, uint256 current, bool isLong) external pure returns (int256) {
        return PositionMath.calculateUnrealizedPnL(size, entry, current, isLong);
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
            sender, origin, block.number, block.timestamp, isOperator, maxActionsPerBlock, minInteractionDelay,
            lastInteractionBlock, trustedForwarders, lastGlobalInteractionBlock, globalBlockInteractions, lastInteractionTimestamp
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
            sender, origin, block.number, block.timestamp, isOperator, maxActionsPerBlock, minInteractionDelay,
            lastInteractionBlock, trustedForwarders, lastGlobalInteractionBlock, globalBlockInteractions, lastInteractionTimestamp
        );
        (lastGlobalInteractionBlock, globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            sender, origin, block.number, block.timestamp, isOperator, maxActionsPerBlock, minInteractionDelay,
            lastInteractionBlock, trustedForwarders, lastGlobalInteractionBlock, globalBlockInteractions, lastInteractionTimestamp
        );
    }

    // ConfigLib Wrappers
    function testSetMarket(address m, address feed, uint256 maxLev, uint256 maxPos, uint256 maxExp, uint256 mmBps, uint256 imBps, uint256 maxStaleness, uint256 maxOracleUncertainty) external {
        ConfigLib.setMarket(m, feed, maxLev, maxPos, maxExp, mmBps, imBps, maxStaleness, maxOracleUncertainty, configMarkets, isMarketActive, activeMarketsList, 20);
    }

    function testUpdateMarket(address m, address feed, uint256 maxLev, uint256 maxPos, uint256 maxExp, uint256 mmBps, uint256 imBps, uint256 maxStaleness, uint256 maxOracleUncertainty) external {
        ConfigLib.updateMarket(m, feed, maxLev, maxPos, maxExp, mmBps, imBps, maxStaleness, maxOracleUncertainty, configMarkets);
    }

    function setUnlistMarket(address m) external {
        ConfigLib.unlistMarket(m, configMarkets, isMarketActive, activeMarketsList);
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
