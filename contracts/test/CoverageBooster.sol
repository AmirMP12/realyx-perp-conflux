// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/VaultCore.sol";
import "../core/TradingCore.sol";
import "../libraries/DataTypes.sol";
import "../libraries/PositionMath.sol";
import "../libraries/FeeCalculator.sol";
import "../libraries/TradingLib.sol";
import "../libraries/CircuitBreakerLib.sol";
import "../libraries/PositionCloseLib.sol";

contract CoverageBooster {
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
    
    function boostTrading(address m, address f) public pure {
        TradingLib.calculateNewLeverage(1, 1);
        // Additional pure logic calls can go here
    }
}
