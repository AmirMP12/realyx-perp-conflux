// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/LiquidationLib.sol";
import "../libraries/DataTypes.sol";

/// @notice Test harness exposing `LiquidationLib.checkLiquidatableBatch`.
contract LiquidationLibHarness {
    mapping(uint256 => DataTypes.Position) private _positions;
    mapping(uint256 => DataTypes.PositionCollateral) private _positionCollateral;

    function setPosition(
        uint256 id,
        DataTypes.PosStatus state,
        address market,
        uint128 size,
        uint128 entryPrice,
        uint8 flags,
        uint64 leverage
    ) external {
        _positions[id] = DataTypes.Position({
            size: size,
            entryPrice: entryPrice,
            liquidationPrice: 0,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            leverage: leverage,
            lastFundingTime: 0,
            market: market,
            openTimestamp: uint40(block.timestamp),
            trailingStopBps: 0,
            flags: flags,
            collateralType: DataTypes.CollateralType.USDC,
            state: state
        });
    }

    function setCollateral(uint256 id, uint256 amount) external {
        _positionCollateral[id] = DataTypes.PositionCollateral({amount: amount, tokenAddress: address(0)});
    }

    function checkBatch(
        uint256[] calldata ids,
        address oracle,
        address[] calldata markets
    ) external view returns (bool[] memory liquidatable, uint256[] memory healthFactors) {
        return LiquidationLib.checkLiquidatableBatch(ids, _positions, _positionCollateral, oracle, markets);
    }

    function canLiquidateAt(uint256 id, uint256 price) external view returns (bool liquidatable, uint256 healthFactor) {
        return LiquidationLib.canLiquidate(_positions[id], _positionCollateral[id], price);
    }
}
