// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/PositionMath.sol";
import "../interfaces/IOracleAggregator.sol";

/**
 * @title PortfolioRiskLib
 * @notice Account-level cross-margin risk aggregation helpers.
 */
library PortfolioRiskLib {
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;

    function getAccountRisk(
        address account,
        address oracleAggregator,
        DataTypes.PortfolioRiskConfig memory cfg,
        mapping(address => uint256[]) storage userPositions,
        mapping(uint256 => DataTypes.Position) storage positions,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral
    ) internal view returns (DataTypes.AccountRiskSnapshot memory snapshot) {
        uint256[] storage ids = userPositions[account];
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; ) {
            DataTypes.Position storage p = positions[ids[i]];
            if (p.state == DataTypes.PosStatus.OPEN && DataTypes.isCrossMargin(p.flags)) {
                DataTypes.PositionCollateral storage col = positionCollateral[ids[i]];
                (uint256 price, , ) = IOracleAggregator(oracleAggregator).getPrice(p.market);
                int256 pnl = PositionMath.calculateUnrealizedPnL(
                    uint256(p.size),
                    uint256(p.entryPrice),
                    price,
                    DataTypes.isLong(p.flags)
                );
                snapshot.unrealizedPnL += pnl;
                snapshot.totalCollateral += col.amount;
                snapshot.totalNotional += uint256(p.size);
                snapshot.maintenanceMarginRequirement +=
                    (uint256(p.size) * _effectiveMmBps(cfg.maintenanceMarginBps)) /
                    BPS;
                unchecked {
                    ++snapshot.crossPositionCount;
                }
            }
            unchecked {
                ++i;
            }
        }

        int256 equity = int256(snapshot.totalCollateral) + snapshot.unrealizedPnL;
        if (snapshot.maintenanceMarginRequirement == 0) {
            snapshot.healthFactor = type(uint256).max;
            snapshot.liquidatable = false;
            return snapshot;
        }
        if (equity <= 0) {
            snapshot.healthFactor = 0;
            snapshot.liquidatable = true;
            return snapshot;
        }
        snapshot.healthFactor = (uint256(equity) * PRECISION) / snapshot.maintenanceMarginRequirement;
        snapshot.liquidatable = snapshot.healthFactor < PRECISION;
    }

    function validateOpenPosition(
        DataTypes.AccountRiskSnapshot memory snapshot,
        DataTypes.PortfolioRiskConfig memory cfg
    ) internal pure returns (bool) {
        if (!cfg.enabled) return true;
        if (cfg.maxCrossPositions > 0 && snapshot.crossPositionCount > cfg.maxCrossPositions) return false;
        if (snapshot.totalNotional > 0 && cfg.concentrationLimitBps > 0) {
            uint256 concentration = (snapshot.maintenanceMarginRequirement * BPS) / snapshot.totalNotional;
            if (concentration > cfg.concentrationLimitBps) return false;
        }
        return !snapshot.liquidatable;
    }

    function _effectiveMmBps(uint16 cfgBps) private pure returns (uint256) {
        return cfgBps == 0 ? 500 : uint256(cfgBps);
    }
}
