// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "./TradingLib.sol";
import "../interfaces/IReferralRegistry.sol";

/**
 * @title TradingContextLib
 * @notice Builds context structs for trading operations. Resolves referral
 *         state for the close path so the engine charges the right discount
 *         and routes the rebate share. The open path resolves referral data
 *         inside `TradingLib.executeOrderFull` to amortize the registry call
 *         over the existing batch read.
 */
library TradingContextLib {
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
        address referrer;
        uint16 discountBps;
        uint16 rebateBps;
        if (referralRegistry != address(0)) {
            try IReferralRegistry(referralRegistry).getTraderReferralData(trader) returns (
                IReferralRegistry.ReferralData memory d
            ) {
                // Clamp to BPS and refuse configurations whose discount +
                // rebate exceed 100% (matches `TradingLib._safeGetReferral`).
                uint16 dBps = d.discountBps > 10000 ? 10000 : d.discountBps;
                uint16 rBps = d.rebateBps > 10000 ? 10000 : d.rebateBps;
                if (uint256(dBps) + uint256(rBps) <= 10000) {
                    referrer = d.referrer;
                    discountBps = dBps;
                    rebateBps = rBps;
                }
            } catch {
                // never let registry hiccups brick a close
            }
        }
        return
            TradingLib.ClosePositionContext(
                usdc_,
                vc,
                oa,
                pt,
                treasury,
                insurance,
                collateralRegistry,
                fc,
                referrer,
                discountBps,
                rebateBps
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
            TradingLib.LiquidatePositionContext(usdc_, vc, oa, pt, treasury, insurance, tradingCore, collateralRegistry, tiers, deviationBps);
    }

    function buildCollateralCtx(
        address usdc_,
        address oa,
        address collateralRegistry_,
        address collateralToken_,
        uint256 maxOracleUncertainty
    ) external pure returns (TradingLib.CollateralContext memory) {
        return TradingLib.CollateralContext(usdc_, oa, collateralRegistry_, collateralToken_, maxOracleUncertainty);
    }
}
