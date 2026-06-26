// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/TradingContextLib.sol";
import "../libraries/TradingLib.sol";
import "../libraries/DataTypes.sol";

contract TradingContextLibHarness {
    function buildCloseCtx(
        address usdc_,
        address vc,
        address oa,
        address pt,
        address treasury,
        address insurance,
        address collateralRegistry,
        DataTypes.FeeConfig memory fc,
        address referralRegistry,
        address trader
    ) external view returns (TradingLib.ClosePositionContext memory) {
        return
            TradingContextLib.buildCloseCtx(
                usdc_,
                vc,
                oa,
                pt,
                treasury,
                insurance,
                collateralRegistry,
                fc,
                referralRegistry,
                trader
            );
    }

    function buildLiqCtx(
        address usdc_,
        address vc,
        address oa,
        address pt,
        address treasury,
        address insurance,
        address tradingCore,
        address collateralRegistry,
        DataTypes.LiquidationFeeTiers memory tiers,
        uint256 deviationBps
    ) external pure returns (TradingLib.LiquidatePositionContext memory) {
        return
            TradingContextLib.buildLiqCtx(
                usdc_,
                vc,
                oa,
                pt,
                treasury,
                insurance,
                tradingCore,
                collateralRegistry,
                tiers,
                deviationBps
            );
    }

    function buildCollateralCtx(
        address usdc_,
        address oa,
        address collateralRegistry_,
        address collateralToken_,
        uint256 maxOracleUncertainty
    ) external pure returns (TradingLib.CollateralContext memory) {
        return
            TradingContextLib.buildCollateralCtx(
                usdc_,
                oa,
                collateralRegistry_,
                collateralToken_,
                maxOracleUncertainty
            );
    }
}
