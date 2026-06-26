// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";

/// @notice Minimal TradingCore stand-in exposing the active-market + market-info
///         surface that TradingCoreViews._globalUnrealizedPnL walks, so the
///         price==0, overflow-skip, and active/inactive branches can be driven.
contract MockCoreForViews {
    address[] private _markets;
    mapping(address => DataTypes.Market) private _info;

    bool private _healthy = true;
    uint256 private _badDebt;

    function addMarket(
        address market,
        bool isActive,
        uint256 totalLongSize,
        uint256 totalLongCost,
        uint256 totalShortSize,
        uint256 totalShortCost
    ) external {
        _markets.push(market);
        DataTypes.Market storage m = _info[market];
        m.isActive = isActive;
        m.isListed = true;
        m.totalLongSize = uint128(totalLongSize);
        m.totalLongCost = totalLongCost;
        m.totalShortSize = uint128(totalShortSize);
        m.totalShortCost = totalShortCost;
    }

    function activeMarketCount() external view returns (uint256) {
        return _markets.length;
    }

    function activeMarketAt(uint256 i) external view returns (address) {
        return _markets[i];
    }

    function getMarketInfo(address c) external view returns (DataTypes.Market memory) {
        return _info[c];
    }

    function getProtocolHealthState() external view returns (bool, uint256, uint64) {
        return (_healthy, _badDebt, uint64(block.timestamp));
    }

    function getPositionCollateral(uint256) external pure returns (uint256, address) {
        return (0, address(0));
    }
}
