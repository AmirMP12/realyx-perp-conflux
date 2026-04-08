// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/FundingLib.sol";
import "../libraries/FeeCalculator.sol";
import "../libraries/PositionMath.sol";
import "../libraries/DataTypes.sol";

contract PositionMathFeeCalculatorWrapper {
    // PositionMath Wrappers
    function calculateUnrealizedPnL(
        uint256 size,
        uint256 entryPrice,
        uint256 currentPrice,
        bool isLong
    ) public pure returns (int256) {
        return PositionMath.calculateUnrealizedPnL(size, entryPrice, currentPrice, isLong);
    }

    function calculateInitialMargin(uint256 size, uint256 leverage) public pure returns (uint256) {
        return PositionMath.calculateInitialMargin(size, leverage);
    }

    function calculateMaintenanceMargin(uint256 size, uint256 bps) public pure returns (uint256) {
        return PositionMath.calculateMaintenanceMargin(size, bps);
    }

    function calculateDynamicMaintenanceMargin(uint256 size, uint256 leverage) public pure returns (uint256) {
        return PositionMath.calculateDynamicMaintenanceMargin(size, leverage);
    }

    function calculateLiquidationPrice(
        uint256 entryPrice,
        uint256 leverage,
        uint256 maintenanceMarginBps,
        bool isLong
    ) public pure returns (uint256) {
        return PositionMath.calculateLiquidationPrice(entryPrice, leverage, maintenanceMarginBps, isLong);
    }

    function shouldTriggerStopLoss(
        uint256 state, // Placeholder for enum
        bool isLong,
        uint256 stopLossPrice,
        uint256 currentPrice
    ) public pure returns (bool) {
        DataTypes.Position memory pos;
        pos.state = DataTypes.PosStatus(state);
        pos.flags = isLong ? 1 : 0;
        pos.stopLossPrice = uint128(stopLossPrice);
        return PositionMath.shouldTriggerStopLoss(pos, currentPrice);
    }

    function shouldTriggerTakeProfit(
        uint256 state, // Placeholder for enum
        bool isLong,
        uint256 takeProfitPrice,
        uint256 currentPrice
    ) public pure returns (bool) {
        DataTypes.Position memory pos;
        pos.state = DataTypes.PosStatus(state);
        pos.flags = isLong ? 1 : 0;
        pos.takeProfitPrice = uint128(takeProfitPrice);
        return PositionMath.shouldTriggerTakeProfit(pos, currentPrice);
    }

    // FeeCalculator Wrappers
    function calculateTradingFeeSimple(
        uint256 size,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        bool isMaker
    ) public pure returns (uint256) {
        DataTypes.FeeConfig memory config = DataTypes.FeeConfig({
            makerFeeBps: makerFeeBps,
            takerFeeBps: takerFeeBps,
            minFeeUsdc: 0,
            lpShareBps: 7000,
            insuranceShareBps: 2000,
            treasuryShareBps: 1000
        });
        return FeeCalculator.calculateTradingFee(size, config, isMaker, 0);
    }

    function calculateLiquidationFee(
        uint256 size,
        uint256 healthFactor
    ) public pure returns (uint256 totalFee, uint256 liquidatorFee, uint256 insuranceFee) {
        DataTypes.LiquidationFeeTiers memory tiers = DataTypes.LiquidationFeeTiers({
            nearThresholdBps: 250,
            mediumRiskBps: 500,
            deeplyUnderwaterBps: 750,
            liquidatorShareBps: 5000
        });
        return FeeCalculator.calculateLiquidationFee(size, healthFactor, tiers);
    }

    function calculateFundingRate(uint256 longSize, uint256 shortSize, uint256 baseRate) public pure returns (int256) {
        return PositionMath.calculateFundingRate(longSize, shortSize, baseRate);
    }

    function calculatePnLPercent(int256 pnl, uint256 collateral) public pure returns (int256) {
        return PositionMath.calculatePnLPercent(pnl, collateral);
    }

    function calculateFundingOwedForPosition(
        uint128 size,
        uint8 flags,
        int256 cumulativeFundingDelta
    ) public pure returns (int256) {
        DataTypes.Position memory p;
        p.size = size;
        p.flags = flags;
        return PositionMath.calculateFundingOwed(p, cumulativeFundingDelta);
    }

    function calculateFundingIntervals(
        uint64 lastSettlement,
        uint256 currentTime,
        uint256 intervalSeconds
    ) public pure returns (uint256) {
        return PositionMath.calculateFundingIntervals(lastSettlement, currentTime, intervalSeconds);
    }

    function validateSlippageExt(
        uint256 expectedPrice,
        uint256 actualPrice,
        uint256 maxSlippageBps,
        bool isLong
    ) public pure returns (bool) {
        return PositionMath.validateSlippage(expectedPrice, actualPrice, maxSlippageBps, isLong);
    }

    function safeMulExt(uint256 a, uint256 b) public pure returns (uint256) {
        return PositionMath.safeMul(a, b);
    }
}
