// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";

/**
 * @title FeeCalculator
 * @notice Fee calculation and distribution logic for the RWA Perpetual Futures Protocol
 * @dev Handles trading fees, liquidation fees, and fee splitting
 */
library FeeCalculator {
    error InvalidFeeConfig();
    error InvalidAmount();
    error FeeExceedsAmount();

    uint256 private constant BPS = 10000;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_FEE_BPS = 1000;
    uint256 public constant DEFAULT_MAKER_FEE_BPS = 2;
    uint256 public constant DEFAULT_TAKER_FEE_BPS = 5;
    uint256 public constant DEFAULT_LP_SHARE_BPS = 7000;
    uint256 public constant DEFAULT_INSURANCE_SHARE_BPS = 2000;
    uint256 public constant DEFAULT_TREASURY_SHARE_BPS = 1000;

    function calculateTradingFee(
        uint256 size,
        DataTypes.FeeConfig memory config,
        bool isMaker,
        uint256 referralDiscountBps
    ) internal pure returns (uint256 fee) {
        if (size == 0) return 0;
        
        uint256 feeBps = isMaker ? config.makerFeeBps : config.takerFeeBps;
        
        if (referralDiscountBps > 0 && referralDiscountBps < feeBps) {
            feeBps -= referralDiscountBps;
        } else if (referralDiscountBps >= feeBps) {
            feeBps = 0;
        }
        
        fee = (size * feeBps) / BPS;
        
        uint256 minFee = DataTypes.toInternalPrecision(config.minFeeUsdc);
        if (fee < minFee) {
            fee = minFee;
        }
    }
    
    function calculateOpeningFee(
        uint256 size,
        DataTypes.FeeConfig memory config
    ) internal pure returns (uint256 fee) {
        fee = (size * config.takerFeeBps) / BPS;
        
        uint256 minFee = DataTypes.toInternalPrecision(config.minFeeUsdc);
        if (fee < minFee) {
            fee = minFee;
        }
    }
    
    function calculateClosingFee(
        uint256 size,
        DataTypes.FeeConfig memory config,
        bool isMarketOrder
    ) internal pure returns (uint256 fee) {
        uint256 feeBps = isMarketOrder ? config.takerFeeBps : config.makerFeeBps;
        fee = (size * feeBps) / BPS;
        
        uint256 minFee = DataTypes.toInternalPrecision(config.minFeeUsdc);
        if (fee < minFee) {
            fee = minFee;
        }
    }

    function calculateLiquidationFee(
        uint256 size,
        uint256 healthFactor,
        DataTypes.LiquidationFeeTiers memory tiers
    ) internal pure returns (
        uint256 totalFee,
        uint256 liquidatorFee,
        uint256 insuranceFee
    ) {
        uint256 feeBps;
        
        if (healthFactor >= 8e17) {
            feeBps = tiers.nearThresholdBps;
        } else if (healthFactor >= 5e17) {
            feeBps = tiers.mediumRiskBps;
        } else {
            feeBps = tiers.deeplyUnderwaterBps;
        }
        
        totalFee = (size * feeBps) / BPS;
        
        uint256 remainingCollateral = (size * healthFactor) / PRECISION;
        uint256 maxFee = remainingCollateral / 2;
        if (totalFee > maxFee && maxFee > 0) {
            totalFee = maxFee;
        }
        
        liquidatorFee = (totalFee * tiers.liquidatorShareBps) / BPS;
        insuranceFee = totalFee - liquidatorFee;
    }
    
    function getDefaultLiquidationTiers() 
        internal 
        pure 
        returns (DataTypes.LiquidationFeeTiers memory tiers) 
    {
        tiers = DataTypes.LiquidationFeeTiers({
            nearThresholdBps: 250,
            mediumRiskBps: 500,
            deeplyUnderwaterBps: 750,
            liquidatorShareBps: 5000
        });
    }

    function splitFees(
        uint256 totalFee,
        DataTypes.FeeConfig memory config
    ) internal pure returns (
        uint256 lpShare,
        uint256 insuranceShare,
        uint256 treasuryShare
    ) {
        if (config.lpShareBps + config.insuranceShareBps + config.treasuryShareBps != BPS) {
            revert InvalidFeeConfig();
        }
        
        lpShare = (totalFee * config.lpShareBps) / BPS;
        insuranceShare = (totalFee * config.insuranceShareBps) / BPS;
        treasuryShare = totalFee - lpShare - insuranceShare;
    }
    
    function getDefaultFeeConfig() 
        internal 
        pure 
        returns (DataTypes.FeeConfig memory config) 
    {
        config = DataTypes.FeeConfig({
            makerFeeBps: DEFAULT_MAKER_FEE_BPS,
            takerFeeBps: DEFAULT_TAKER_FEE_BPS,
            minFeeUsdc: 100000,
            lpShareBps: DEFAULT_LP_SHARE_BPS,
            insuranceShareBps: DEFAULT_INSURANCE_SHARE_BPS,
            treasuryShareBps: DEFAULT_TREASURY_SHARE_BPS
        });
    }

    function calculateKeeperReward(
        uint256 gasUsed,
        uint256 gasPrice,
        uint256 ethUsdPrice,
        uint256 rewardMultiplierBps
    ) internal pure returns (uint256 rewardUsdc) {
        uint256 gasCostWei = gasUsed * gasPrice;
        uint256 gasCostUsd = (gasCostWei * ethUsdPrice) / 1e18;
        uint256 rewardInternal = (gasCostUsd * rewardMultiplierBps) / BPS;
        rewardUsdc = DataTypes.toUsdcPrecision(rewardInternal);
    }
    
    function calculateGasRefund(
        uint256 gasUsed,
        uint256 gasPrice,
        uint256 ethUsdPrice,
        uint256 maxRefundUsdc
    ) internal pure returns (uint256 refundUsdc) {
        uint256 gasCostWei = gasUsed * gasPrice;
        uint256 gasCostUsd = (gasCostWei * ethUsdPrice) / 1e18;
        refundUsdc = DataTypes.toUsdcPrecision(gasCostUsd);
        
        if (refundUsdc > maxRefundUsdc) {
            refundUsdc = maxRefundUsdc;
        }
    }

    function calculateConditionalOrderFee(
        uint256 size,
        uint8 executionType
    ) internal pure returns (uint256 fee) {
        uint256 feeBps;
        
        if (executionType == 0) {
            feeBps = 3;
        } else if (executionType == 1) {
            feeBps = 3;
        } else {
            feeBps = 5;
        }
        
        fee = (size * feeBps) / BPS;
    }
    
    function calculatePositionTransferFee(
        uint256 positionValue,
        uint256 transferFeeBps
    ) internal pure returns (uint256 fee) {
        fee = (positionValue * transferFeeBps) / BPS;
    }
    
    function calculateCrossMarginConversionFee(
        uint256 collateralValue
    ) internal pure returns (uint256 fee) {
        fee = (collateralValue * 1) / BPS;
    }

    function validateFeeConfig(
        DataTypes.FeeConfig memory config
    ) internal pure returns (bool valid) {
        if (config.makerFeeBps > MAX_FEE_BPS) return false;
        if (config.takerFeeBps > MAX_FEE_BPS) return false;
        
        if (config.lpShareBps + config.insuranceShareBps + config.treasuryShareBps != BPS) {
            return false;
        }
        
        if (config.takerFeeBps < config.makerFeeBps) return false;
        
        return true;
    }
    
    function calculateEffectiveFeeRate(
        uint256 baseFee,
        uint256 referralDiscountBps,
        uint256 maxDiscountBps
    ) internal pure returns (uint256 effectiveFee) {
        uint256 discount = referralDiscountBps > maxDiscountBps 
            ? maxDiscountBps 
            : referralDiscountBps;
        
        effectiveFee = baseFee > discount ? baseFee - discount : 0;
    }
}
