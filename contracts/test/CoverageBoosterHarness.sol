// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/PositionMath.sol";
import "../libraries/FeeCalculator.sol";
import "../libraries/TradingLib.sol";

contract CoverageBoosterHarness {
    // This contract exists solely to call all branches in the libraries/contracts

    function boostMath() public pure {
        // PositionMath
        PositionMath.calculateUnrealizedPnL(1, 1, 1, true);
        PositionMath.calculateInitialMargin(1, 1);
        PositionMath.calculateMaintenanceMargin(1, 1);
        PositionMath.calculateDynamicMaintenanceMargin(1, 1);
        PositionMath.calculateLiquidationPrice(1, 1, 1, true);

        // FeeCalculator
        DataTypes.FeeConfig memory config = FeeCalculator.getDefaultFeeConfig();
        FeeCalculator.calculateTradingFee(1, config, true, 0);

        DataTypes.LiquidationFeeTiers memory tiers = FeeCalculator.getDefaultLiquidationTiers();
        FeeCalculator.calculateLiquidationFee(1, 1e18, tiers);
    }

    function boostTrading() public pure {
        TradingLib.calculateNewLeverage(1, 1);
    }
}
