// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "./TradingLib.sol";

/**
 * @title TradingContextLib
 * @notice Builds context structs for trading operations
 */
library TradingContextLib {
    function buildCloseCtx(
        address usdc_,
        address vc,
        address oa,
        address pt,
        address treasury,
        address insurance,
        DataTypes.FeeConfig memory fc
    ) external pure returns (TradingLib.ClosePositionContext memory) {
        return TradingLib.ClosePositionContext(usdc_, vc, oa, pt, treasury, insurance, fc);
    }

    function buildLiqCtx(
        address usdc_,
        address vc,
        address oa,
        address pt,
        address treasury,
        address insurance,
        DataTypes.LiquidationFeeTiers memory tiers,
        uint256 deviationBps
    ) external pure returns (TradingLib.LiquidatePositionContext memory) {
        return TradingLib.LiquidatePositionContext(usdc_, vc, oa, pt, treasury, insurance, tiers, deviationBps);
    }

    function buildCollateralCtx(
        address usdc_,
        address oa,
        uint256 maxOracleUncertainty
    ) external pure returns (TradingLib.CollateralContext memory) {
        return TradingLib.CollateralContext(usdc_, oa, maxOracleUncertainty);
    }
}
