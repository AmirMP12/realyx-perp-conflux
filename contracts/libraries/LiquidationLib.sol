// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IPositionToken.sol";
import "../interfaces/IVaultCore.sol";
import "../interfaces/IOracleAggregator.sol";
import "../interfaces/ITradingCore.sol";
import "./DataTypes.sol";
import "./PositionMath.sol";
import "./FeeCalculator.sol";

/**
 * @title LiquidationLib
 * @notice Library for liquidation operations
 */
library LiquidationLib {
    using SafeERC20 for IERC20;
    using PositionMath for DataTypes.Position;
    
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant TWAP_WINDOW_SECONDS = 15 minutes;
    uint256 private constant MIN_LIQUIDATOR_REWARD_BPS = 2500;
    uint256 private constant MAX_LIQUIDATION_PRICE_DEVIATION_BPS = 1000;
    
    event InsufficientBalanceForLiquidation(uint256 indexed positionId, uint256 needed, uint256 available);
    
    struct LiquidatePositionContext {
        address usdc;
        address liquidityVault;
        address oracleAggregator;
        address positionToken;
        address treasury;
        address insuranceFund;
        DataTypes.LiquidationFeeTiers liquidationTiers;
        uint256 liquidationDeviationBps;
    }
    
    error PositionNotFound();
    error PositionNotLiquidatable();
    error LiquidationPriceDeviation();
    error InsufficientLiquidatorReward();
    error InsufficientLiquidityForRepayment();
    error RepayFailed();
    
    function liquidatePosition(
        uint256 positionId,
        LiquidatePositionContext memory ctx,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.Market) storage /* markets */,
        mapping(address => uint256) storage userExposure
    ) external returns (uint256 liquidatorReward) {
        DataTypes.Position storage position = positions[positionId];
        if (position.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();
        
        (uint256 currentPrice,,) = IOracleAggregator(ctx.oracleAggregator).getPrice(position.market);
        uint256 collateralValue = positionCollateral[positionId].amount;
        
        (bool canLiq, uint256 healthFactor) = position.isLiquidatable(currentPrice, collateralValue);
        if (!canLiq) revert PositionNotLiquidatable();
        
        uint256 twapPrice = IOracleAggregator(ctx.oracleAggregator).getTWAP(position.market, TWAP_WINDOW_SECONDS);
        if (twapPrice > 0) {
            uint256 deviation = currentPrice > twapPrice 
                ? ((currentPrice - twapPrice) * BPS) / twapPrice
                : ((twapPrice - currentPrice) * BPS) / twapPrice;
            uint256 maxDeviation = ctx.liquidationDeviationBps > 0 
                ? ctx.liquidationDeviationBps 
                : MAX_LIQUIDATION_PRICE_DEVIATION_BPS;
            if (deviation > maxDeviation) revert LiquidationPriceDeviation();
        }
        
        (uint256 totalFee, uint256 liqFee, uint256 insFee) = FeeCalculator.calculateLiquidationFee(
            uint256(position.size), 
            healthFactor, 
            ctx.liquidationTiers
        );
        uint256 liqFeeUsdc = DataTypes.toUsdcPrecision(liqFee);
        uint256 insFeeUsdc = DataTypes.toUsdcPrecision(insFee);
        uint256 totalNeededUsdc = liqFeeUsdc + insFeeUsdc;
        
        bool isLong = DataTypes.isLong(position.flags);
        int256 pnl = PositionMath.calculateUnrealizedPnL(
            uint256(position.size), 
            uint256(position.entryPrice), 
            currentPrice, 
            isLong
        );
        
        uint256 borrowedAmount = uint256(position.size) - collateralValue;
        uint256 repayAmountUsdc = DataTypes.toUsdcPrecisionCeil(borrowedAmount);
        uint256 receiveAmount = pnl >= 0 ? repayAmountUsdc : repayAmountUsdc + DataTypes.toUsdcPrecisionCeil(uint256(-pnl));
        uint256 collateralUsdc = DataTypes.toUsdcPrecision(collateralValue);

        uint256 availableUsdc = collateralUsdc + repayAmountUsdc;
        uint256 totalRequired = receiveAmount + totalNeededUsdc;
        uint256 insuranceAmountUsdc = insFeeUsdc;

        if (availableUsdc < totalRequired) {
            uint256 shortfall = totalRequired - availableUsdc;
            uint256 covered = IVaultCore(ctx.insuranceFund).coverBadDebt(shortfall, positionId);
            
            if (covered < shortfall) {
                uint256 actualAvailable = availableUsdc + covered;
                if (actualAvailable < receiveAmount) revert InsufficientLiquidityForRepayment();
                
                uint256 remainingForFees = actualAvailable - receiveAmount;
                if (remainingForFees >= liqFeeUsdc) {
                    liquidatorReward = liqFeeUsdc;
                    insuranceAmountUsdc = remainingForFees - liqFeeUsdc;
                } else {
                    liquidatorReward = remainingForFees;
                    insuranceAmountUsdc = 0;
                    emit InsufficientBalanceForLiquidation(positionId, totalNeededUsdc, remainingForFees);
                }
            } else {
                liquidatorReward = liqFeeUsdc;
                insuranceAmountUsdc = insFeeUsdc;
            }
        } else {
            liquidatorReward = liqFeeUsdc;
            insuranceAmountUsdc = insFeeUsdc;
        }

        address self = address(this);
        if (IERC20(ctx.usdc).balanceOf(self) < receiveAmount) revert InsufficientLiquidityForRepayment();

        int256 pnlUsdc = pnl >= 0
            ? int256(DataTypes.toUsdcPrecision(uint256(pnl)))
            : -int256(DataTypes.toUsdcPrecisionCeil(uint256(-pnl)));

        IERC20(ctx.usdc).forceApprove(ctx.liquidityVault, 0);
        IERC20(ctx.usdc).forceApprove(ctx.liquidityVault, receiveAmount);
        try IVaultCore(ctx.liquidityVault).repay(repayAmountUsdc, position.market, isLong, pnlUsdc) {
        } catch {
            IERC20(ctx.usdc).forceApprove(ctx.liquidityVault, 0);
            revert RepayFailed();
        }
        IERC20(ctx.usdc).forceApprove(ctx.liquidityVault, 0);

        uint256 minExpectedRewardUsdc = (liqFeeUsdc * MIN_LIQUIDATOR_REWARD_BPS) / BPS;
        uint256 absoluteMin = 10e6;
        if (liquidatorReward < minExpectedRewardUsdc || (liquidatorReward > 0 && liquidatorReward < absoluteMin)) {
            revert InsufficientLiquidatorReward();
        }

        if (liquidatorReward > 0) {
            IERC20(ctx.usdc).safeTransfer(msg.sender, liquidatorReward);
        }
        if (insuranceAmountUsdc > 0) {
            IERC20(ctx.usdc).safeTransfer(ctx.insuranceFund, insuranceAmountUsdc);
            IVaultCore(ctx.insuranceFund).receiveFees(insuranceAmountUsdc);
        }

        address owner = IPositionToken(ctx.positionToken).ownerOf(positionId);
        uint256 exposureDecrease = DataTypes.toUsdcPrecision(uint256(position.size));
        userExposure[owner] = userExposure[owner] > exposureDecrease
            ? userExposure[owner] - exposureDecrease
            : 0;

        position.state = DataTypes.PosStatus.LIQUIDATED;
        IPositionToken(ctx.positionToken).burn(positionId);

        emit ITradingCore.PositionLiquidated(positionId, msg.sender, currentPrice, DataTypes.toUsdcPrecision(totalFee));
    }
    
    function canLiquidate(
        DataTypes.Position storage position,
        DataTypes.PositionCollateral storage collateral,
        uint256 currentPrice
    ) public view returns (bool liquidatable, uint256 healthFactor) {
        if (position.state != DataTypes.PosStatus.OPEN) return (false, type(uint256).max);
        return position.isLiquidatable(currentPrice, collateral.amount);
    }
    
    function checkLiquidatableBatch(
        uint256[] memory positionIds,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        address oracleAggregator,
        address[] memory /* markets */
    ) public view returns (bool[] memory liquidatable, uint256[] memory healthFactors) {
        liquidatable = new bool[](positionIds.length);
        healthFactors = new uint256[](positionIds.length);
        
        for (uint256 i = 0; i < positionIds.length;) {
            DataTypes.Position storage pos = positions[positionIds[i]];
            if (pos.state == DataTypes.PosStatus.OPEN) {
                (uint256 price,,) = IOracleAggregator(oracleAggregator).getPrice(pos.market);
                (liquidatable[i], healthFactors[i]) = pos.isLiquidatable(price, positionCollateral[positionIds[i]].amount);
            } else {
                healthFactors[i] = type(uint256).max;
            }
            unchecked { ++i; }
        }
    }
}
