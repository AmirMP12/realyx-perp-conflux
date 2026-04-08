// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IPositionToken.sol";
import "../interfaces/IOracleAggregator.sol";
import "../interfaces/ITradingCore.sol";
import "./DataTypes.sol";

/**
 * @title PositionTriggersLib
 * @notice Stop loss, take profit, trailing stop
 */
library PositionTriggersLib {
    error PositionNotFound();
    error NotPositionOwner();
    error InvalidStopLoss();
    error InvalidTakeProfit();
    error InvalidTrailingStop();

    function validateStopLoss(uint256 sl, uint256 price, bool isLong) internal pure returns (bool) {
        if (sl == 0) return true;
        return isLong ? sl < price : sl > price;
    }

    function validateTakeProfit(uint256 tp, uint256 price, bool isLong) internal pure returns (bool) {
        if (tp == 0) return true;
        return isLong ? tp > price : tp < price;
    }

    function setStopLoss(
        uint256 id,
        uint256 sl,
        address positionTokenAddr,
        address oracleAggregatorAddr,
        uint256 maxOracleUncertainty,
        mapping(uint256 => DataTypes.Position) storage positions
    ) external {
        DataTypes.Position storage p = positions[id];
        if (p.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();
        if (IPositionToken(positionTokenAddr).ownerOf(id) != msg.sender) revert NotPositionOwner();
        if (
            !validateStopLoss(
                sl,
                IOracleAggregator(oracleAggregatorAddr).getPriceWithConfidence(p.market, maxOracleUncertainty),
                DataTypes.isLong(p.flags)
            )
        ) revert InvalidStopLoss();
        p.stopLossPrice = uint128(sl);
        emit ITradingCore.PositionModified(id, uint256(p.size), uint256(p.leverage), sl, p.takeProfitPrice);
    }

    function setTakeProfit(
        uint256 id,
        uint256 tp,
        address positionTokenAddr,
        address oracleAggregatorAddr,
        uint256 maxOracleUncertainty,
        mapping(uint256 => DataTypes.Position) storage positions
    ) external {
        DataTypes.Position storage p = positions[id];
        if (p.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();
        if (IPositionToken(positionTokenAddr).ownerOf(id) != msg.sender) revert NotPositionOwner();
        if (
            !validateTakeProfit(
                tp,
                IOracleAggregator(oracleAggregatorAddr).getPriceWithConfidence(p.market, maxOracleUncertainty),
                DataTypes.isLong(p.flags)
            )
        ) revert InvalidTakeProfit();
        p.takeProfitPrice = uint128(tp);
        emit ITradingCore.PositionModified(id, uint256(p.size), uint256(p.leverage), p.stopLossPrice, tp);
    }

    function setTrailingStop(
        uint256 id,
        uint256 bps,
        uint256 maxTrailingBps,
        address positionTokenAddr,
        mapping(uint256 => DataTypes.Position) storage positions
    ) external {
        if (bps > maxTrailingBps) revert InvalidTrailingStop();
        DataTypes.Position storage p = positions[id];
        if (p.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();
        if (IPositionToken(positionTokenAddr).ownerOf(id) != msg.sender) revert NotPositionOwner();
        p.trailingStopBps = uint16(bps);
        emit ITradingCore.PositionModified(
            id,
            uint256(p.size),
            uint256(p.leverage),
            p.stopLossPrice,
            p.takeProfitPrice
        );
    }
}
