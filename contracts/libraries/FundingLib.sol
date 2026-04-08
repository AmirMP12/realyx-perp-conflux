// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "./PositionMath.sol";

/**
 * @title FundingLib
 * @notice Library for funding rate calculations and settlements
 */
library FundingLib {
    using PositionMath for DataTypes.Position;

    uint256 private constant BASE_FUNDING_RATE = 1e14;

    event FundingSettled(address indexed market, int256 fundingRate, int256 cumulativeFunding, uint256 timestamp);
    event FundingShortfall(uint256 indexed positionId, uint256 shortfall);
    event PositionUnderwaterAfterFunding(uint256 indexed positionId, uint256 shortfall);

    function settleFunding(
        DataTypes.FundingState storage fundingState,
        DataTypes.Market storage m,
        address market
    ) external returns (int256 fundingRate) {
        uint256 intervalsElapsed = PositionMath.calculateFundingIntervals(
            fundingState.lastSettlement,
            block.timestamp,
            DataTypes.FUNDING_INTERVAL
        );

        if (intervalsElapsed == 0) return fundingState.fundingRate;
        if (intervalsElapsed > DataTypes.MAX_FUNDING_INTERVALS) {
            intervalsElapsed = DataTypes.MAX_FUNDING_INTERVALS;
        }

        fundingRate = PositionMath.calculateFundingRate(m.totalLongSize, m.totalShortSize, BASE_FUNDING_RATE);

        fundingState.fundingRate = fundingRate;
        fundingState.cumulativeFunding += fundingRate * int256(intervalsElapsed);
        fundingState.lastSettlement = uint64(block.timestamp);
        fundingState.longOpenInterest = m.totalLongSize;
        fundingState.shortOpenInterest = m.totalShortSize;

        emit FundingSettled(market, fundingRate, fundingState.cumulativeFunding, block.timestamp);
    }

    function applyFundingToCollateral(
        DataTypes.PositionCollateral storage collateral,
        int256 fundingPaid,
        uint256 positionId
    ) public returns (uint256 newCollateral, uint256 shortfall) {
        if (fundingPaid > 0) {
            uint256 owed = uint256(fundingPaid);
            if (collateral.amount >= owed) {
                collateral.amount -= owed;
                newCollateral = collateral.amount;
            } else {
                shortfall = owed - collateral.amount;
                collateral.amount = 0;
                emit FundingShortfall(positionId, shortfall);
                emit PositionUnderwaterAfterFunding(positionId, shortfall);
            }
        } else if (fundingPaid < 0) {
            collateral.amount += uint256(-fundingPaid);
            newCollateral = collateral.amount;
        } else {
            newCollateral = collateral.amount;
        }
    }

    function settlePositionFunding(
        uint256 positionId,
        address oracleAggregator,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        mapping(address => DataTypes.FundingState) storage fundingStates,
        mapping(uint256 => int256) storage positionCumulativeFunding
    ) external returns (int256 paid) {
        DataTypes.Position storage p = positions[positionId];
        if (p.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();

        DataTypes.FundingState storage fs = fundingStates[p.market];
        int256 delta = fs.cumulativeFunding - positionCumulativeFunding[positionId];

        paid = PositionMath.calculateFundingOwed(p, delta);
        positionCumulativeFunding[positionId] = fs.cumulativeFunding;
        p.lastFundingTime = uint64(block.timestamp);

        DataTypes.PositionCollateral storage col = positionCollateral[positionId];
        applyFundingToCollateral(col, paid, positionId);

        (uint256 price, , ) = IFundingOracle(oracleAggregator).getPrice(p.market);
        (bool liq, uint256 healthFactor) = p.isLiquidatable(price, col.amount);
        if (liq) emit PositionUnderwaterAfterFunding(positionId, healthFactor);
    }

    error PositionNotFound();
}

/**
 * @title IFundingOracle
 * @notice Minimal oracle interface required by FundingLib.
 * @dev Returns normalized price, confidence, and timestamp for a market.
 */
interface IFundingOracle {
    function getPrice(address collection) external view returns (uint256 price, uint256 confidence, uint256 timestamp);
}
