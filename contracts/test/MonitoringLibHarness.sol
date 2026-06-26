// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/MonitoringLib.sol";
import "../libraries/DataTypes.sol";

contract MonitoringLibHarness {
    DataTypes.ProtocolHealthState public protocolHealth;
    address[] public activeMarkets;
    mapping(address => DataTypes.Market) public markets;
    mapping(uint256 => DataTypes.Position) public positions;
    mapping(uint256 => DataTypes.PositionCollateral) public positionCollateral;

    function setProtocolHealth(bool isHealthy, uint256 totalBadDebt, uint64 lastHealthCheck) external {
        protocolHealth.isHealthy = isHealthy;
        protocolHealth.totalBadDebt = totalBadDebt;
        protocolHealth.lastHealthCheck = lastHealthCheck;
    }

    function addActiveMarket(address market) external {
        activeMarkets.push(market);
    }

    function setMarket(address market, bool isActive, uint256 longSize, uint256 shortSize) external {
        markets[market].isActive = isActive;
        markets[market].totalLongSize = longSize;
        markets[market].totalShortSize = shortSize;
        markets[market].totalLongCost = longSize; // Simplified for testing
        markets[market].totalShortCost = shortSize;
    }

    function setPosition(
        uint256 positionId,
        DataTypes.PosStatus state,
        address market,
        uint128 size,
        uint128 entryPrice,
        uint8 flags
    ) external {
        positions[positionId].state = state;
        positions[positionId].market = market;
        positions[positionId].size = size;
        positions[positionId].entryPrice = entryPrice;
        positions[positionId].flags = flags;
    }

    function setCollateral(uint256 positionId, uint256 amount) external {
        positionCollateral[positionId].amount = amount;
    }

    function getCircuitStatus(
        address oracleAggregator,
        address market
    ) external view returns (bool isRestricted, uint256 activeBreakers, bool globalPause) {
        return MonitoringLib.getCircuitBreakerStatus(oracleAggregator, market);
    }

    function getProtocolHealth(
        address vaultCore,
        address oracleAggregator
    )
        external
        view
        returns (
            bool isHealthy,
            uint256 totalBadDebt,
            uint256 totalAssets,
            uint256 badDebtRatioBps,
            uint256 lastHealthCheck,
            int256 globalPnL
        )
    {
        return MonitoringLib.getProtocolHealth(protocolHealth, vaultCore, activeMarkets, markets, oracleAggregator);
    }

    function getPositionHealth(
        uint256 positionId,
        address oracleAggregator
    )
        external
        view
        returns (
            bool isLiquidatable,
            uint256 healthFactor,
            int256 unrealizedPnL,
            uint256 currentPrice,
            bool stopLossTriggered,
            bool takeProfitTriggered
        )
    {
        return MonitoringLib.getPositionHealth(positions[positionId], positionCollateral[positionId], oracleAggregator);
    }
}
