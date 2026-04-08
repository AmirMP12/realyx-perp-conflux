// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/PositionMath.sol";
import "../libraries/TradingLib.sol";
import "../libraries/GlobalPnLLib.sol";
import "../interfaces/IVaultCore.sol";
import "../interfaces/IOracleAggregator.sol";

/**
 * @title MonitoringLib
 * @notice Library for monitoring and health check functions
 */
library MonitoringLib {
    uint256 private constant BPS = 10000;

    function getProtocolHealth(
        DataTypes.ProtocolHealthState storage protocolHealth,
        address vaultCore,
        address[] storage activeMarkets,
        mapping(address => DataTypes.Market) storage markets,
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
        totalAssets = IVaultCore(vaultCore).totalAssets();
        totalBadDebt = protocolHealth.totalBadDebt;
        isHealthy = protocolHealth.isHealthy;
        lastHealthCheck = protocolHealth.lastHealthCheck;
        badDebtRatioBps = totalAssets > 0 ? (totalBadDebt * BPS) / totalAssets : 0;
        globalPnL = GlobalPnLLib.getGlobalUnrealizedPnL(activeMarkets, markets, oracleAggregator);
    }

    function getCircuitBreakerStatus(
        address oracleAggregator,
        address market
    ) external view returns (bool isRestricted, uint256 activeBreakers, bool globalPause) {
        (isRestricted, activeBreakers) = IOracleAggregator(oracleAggregator).isMarketRestricted(market);
        globalPause = IOracleAggregator(oracleAggregator).isGloballyPaused();
    }

    function getPositionHealth(
        DataTypes.Position storage pos,
        DataTypes.PositionCollateral storage collateral,
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
        if (pos.state != DataTypes.PosStatus.OPEN) return (false, type(uint256).max, 0, 0, false, false);
        (currentPrice, , ) = IOracleAggregator(oracleAggregator).getPrice(pos.market);
        (isLiquidatable, healthFactor) = TradingLib.canLiquidate(pos, collateral, currentPrice);
        (unrealizedPnL, ) = TradingLib.getPositionPnL(pos, collateral, currentPrice);
        stopLossTriggered = PositionMath.shouldTriggerStopLoss(pos, currentPrice);
        takeProfitTriggered = PositionMath.shouldTriggerTakeProfit(pos, currentPrice);
    }
}
