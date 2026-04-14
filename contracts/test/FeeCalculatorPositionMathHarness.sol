// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/FeeCalculator.sol";
import "../libraries/PositionMath.sol";
import "../libraries/DataTypes.sol";

/**
 * @title FeeCalculatorPositionMathHarness
 * @notice Test harness exposing FeeCalculator and PositionMath helpers.
 */
contract FeeCalculatorPositionMathHarness {
    // ================== FeeCalculator ==================

    function calcTradingFee(
        uint256 size,
        uint256 makerBps,
        uint256 takerBps,
        uint256 minFeeUsdc,
        bool isMaker,
        uint256 referralDiscountBps
    ) external pure returns (uint256) {
        DataTypes.FeeConfig memory cfg = DataTypes.FeeConfig({
            makerFeeBps: makerBps,
            takerFeeBps: takerBps,
            minFeeUsdc: minFeeUsdc,
            lpShareBps: 7000,
            insuranceShareBps: 2000,
            treasuryShareBps: 1000
        });
        return FeeCalculator.calculateTradingFee(size, cfg, isMaker, referralDiscountBps);
    }

    function calcOpeningFee(uint256 size, uint256 takerBps, uint256 minFee) external pure returns (uint256) {
        DataTypes.FeeConfig memory cfg = DataTypes.FeeConfig({
            makerFeeBps: 2,
            takerFeeBps: takerBps,
            minFeeUsdc: minFee,
            lpShareBps: 7000,
            insuranceShareBps: 2000,
            treasuryShareBps: 1000
        });
        return FeeCalculator.calculateOpeningFee(size, cfg);
    }

    function calcClosingFee(
        uint256 size,
        uint256 makerBps,
        uint256 takerBps,
        uint256 minFee,
        bool isMarket
    ) external pure returns (uint256) {
        DataTypes.FeeConfig memory cfg = DataTypes.FeeConfig({
            makerFeeBps: makerBps,
            takerFeeBps: takerBps,
            minFeeUsdc: minFee,
            lpShareBps: 7000,
            insuranceShareBps: 2000,
            treasuryShareBps: 1000
        });
        return FeeCalculator.calculateClosingFee(size, cfg, isMarket);
    }

    function calcLiqFee(
        uint256 size,
        uint256 healthFactor
    ) external pure returns (uint256 total, uint256 liqFee, uint256 insFee) {
        DataTypes.LiquidationFeeTiers memory tiers = FeeCalculator.getDefaultLiquidationTiers();
        return FeeCalculator.calculateLiquidationFee(size, healthFactor, tiers);
    }

    function splitFees(
        uint256 total,
        uint256 lpBps,
        uint256 insBps,
        uint256 treasBps
    ) external pure returns (uint256, uint256, uint256) {
        DataTypes.FeeConfig memory cfg = DataTypes.FeeConfig({
            makerFeeBps: 2,
            takerFeeBps: 5,
            minFeeUsdc: 0,
            lpShareBps: lpBps,
            insuranceShareBps: insBps,
            treasuryShareBps: treasBps
        });
        return FeeCalculator.splitFees(total, cfg);
    }

    function validateFeeConfig(
        uint256 makerBps,
        uint256 takerBps,
        uint256 lpBps,
        uint256 insBps,
        uint256 treasBps
    ) external pure returns (bool) {
        DataTypes.FeeConfig memory cfg = DataTypes.FeeConfig({
            makerFeeBps: makerBps,
            takerFeeBps: takerBps,
            minFeeUsdc: 0,
            lpShareBps: lpBps,
            insuranceShareBps: insBps,
            treasuryShareBps: treasBps
        });
        return FeeCalculator.validateFeeConfig(cfg);
    }

    function calcKeeperReward(
        uint256 gasUsed,
        uint256 gasPrice,
        uint256 ethPrice,
        uint256 multBps
    ) external pure returns (uint256) {
        return FeeCalculator.calculateKeeperReward(gasUsed, gasPrice, ethPrice, multBps);
    }

    function calcGasRefund(
        uint256 gasUsed,
        uint256 gasPrice,
        uint256 ethPrice,
        uint256 maxRefund
    ) external pure returns (uint256) {
        return FeeCalculator.calculateGasRefund(gasUsed, gasPrice, ethPrice, maxRefund);
    }

    function calcConditionalOrderFee(uint256 size, uint8 execType) external pure returns (uint256) {
        return FeeCalculator.calculateConditionalOrderFee(size, execType);
    }

    function calcPositionTransferFee(uint256 val, uint256 feeBps) external pure returns (uint256) {
        return FeeCalculator.calculatePositionTransferFee(val, feeBps);
    }

    function calcCrossMarginFee(uint256 val) external pure returns (uint256) {
        return FeeCalculator.calculateCrossMarginConversionFee(val);
    }

    function calcEffectiveFeeRate(uint256 baseFee, uint256 refBps, uint256 maxBps) external pure returns (uint256) {
        return FeeCalculator.calculateEffectiveFeeRate(baseFee, refBps, maxBps);
    }

    // ================== PositionMath ==================

    function calcPnL(uint256 size, uint256 entry, uint256 current, bool isLong) external pure returns (int256) {
        return PositionMath.calculateUnrealizedPnL(size, entry, current, isLong);
    }

    function calcRealizedPnL(int256 unrealized, uint256 fee, int256 fundingOwed) external pure returns (int256) {
        return PositionMath.calculateRealizedPnL(unrealized, fee, fundingOwed);
    }

    function calcPnLPercent(int256 pnl, uint256 collateral) external pure returns (int256) {
        return PositionMath.calculatePnLPercent(pnl, collateral);
    }

    function calcInitialMargin(uint256 size, uint256 leverage) external pure returns (uint256) {
        return PositionMath.calculateInitialMargin(size, leverage);
    }

    function calcMaintenanceMargin(uint256 size, uint256 bps) external pure returns (uint256) {
        return PositionMath.calculateMaintenanceMargin(size, bps);
    }

    function calcDynamicMM(uint256 size, uint256 leverage) external pure returns (uint256) {
        return PositionMath.calculateDynamicMaintenanceMargin(size, leverage);
    }

    function calcLiqPrice(uint256 entry, uint256 leverage, uint256 size, bool isLong) external pure returns (uint256) {
        return PositionMath.calculateLiquidationPrice(entry, leverage, size, isLong);
    }

    function calcFundingRate(uint256 longSize, uint256 shortSize, uint256 baseRate) external pure returns (int256) {
        return PositionMath.calculateFundingRate(longSize, shortSize, baseRate);
    }

    function calcFundingOwed(uint128 size, uint8 flags, int256 delta) external pure returns (int256) {
        DataTypes.Position memory pos;
        pos.size = size;
        pos.flags = flags;
        pos.state = DataTypes.PosStatus.OPEN;
        pos.entryPrice = 50000e18;
        pos.leverage = 20;
        return PositionMath.calculateFundingOwed(pos, delta);
    }

    function calcFundingIntervals(
        uint64 lastSettlement,
        uint256 curTime,
        uint256 interval
    ) external pure returns (uint256) {
        return PositionMath.calculateFundingIntervals(lastSettlement, curTime, interval);
    }

    function validateSlippage(
        uint256 expected,
        uint256 actual,
        uint256 maxBps,
        bool isLong
    ) external pure returns (bool) {
        return PositionMath.validateSlippage(expected, actual, maxBps, isLong);
    }

    function trigSL(bool isLong, uint128 slPrice, uint256 curPrice) external pure returns (bool) {
        DataTypes.Position memory pos;
        pos.state = DataTypes.PosStatus.OPEN;
        pos.flags = isLong ? 1 : 0;
        pos.stopLossPrice = slPrice;
        return PositionMath.shouldTriggerStopLoss(pos, curPrice);
    }

    function trigTP(bool isLong, uint128 tpPrice, uint256 curPrice) external pure returns (bool) {
        DataTypes.Position memory pos;
        pos.state = DataTypes.PosStatus.OPEN;
        pos.flags = isLong ? 1 : 0;
        pos.takeProfitPrice = tpPrice;
        return PositionMath.shouldTriggerTakeProfit(pos, curPrice);
    }

    function isLiquidatable(
        uint128 size,
        uint128 entry,
        uint8 flags,
        uint64 leverage,
        uint256 currentPrice,
        uint256 collateral
    ) external pure returns (bool, uint256) {
        DataTypes.Position memory pos;
        pos.size = size;
        pos.entryPrice = entry;
        pos.flags = flags;
        pos.state = DataTypes.PosStatus.OPEN;
        pos.leverage = leverage;
        pos.liquidationPrice = 0;
        return PositionMath.isLiquidatable(pos, currentPrice, collateral);
    }

    function isLiquidatableClosed(
        uint128 size,
        uint128 entry,
        uint8 flags,
        uint256 currentPrice,
        uint256 collateral
    ) external pure returns (bool, uint256) {
        DataTypes.Position memory pos;
        pos.size = size;
        pos.entryPrice = entry;
        pos.flags = flags;
        pos.state = DataTypes.PosStatus.CLOSED;
        pos.leverage = 20;
        return PositionMath.isLiquidatable(pos, currentPrice, collateral);
    }

    function safeMul(uint256 a, uint256 b) external pure returns (uint256) {
        return PositionMath.safeMul(a, b);
    }

    // ================== DataTypes Helpers ==================

    function testIsLong(uint8 flags) external pure returns (bool) {
        return DataTypes.isLong(flags);
    }

    function testToInternal(uint256 val) external pure returns (uint256) {
        return DataTypes.toInternalPrecision(val);
    }

    function testToUsdc(uint256 val) external pure returns (uint256) {
        return DataTypes.toUsdcPrecision(val);
    }

    function testPackFlags(bool isLong, bool isCrossMargin) external pure returns (uint8) {
        return DataTypes.packFlags(isLong, isCrossMargin);
    }
}
