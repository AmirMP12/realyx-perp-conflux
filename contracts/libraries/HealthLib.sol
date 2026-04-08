// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";

/**
 * @title HealthLib
 * @notice Computes and updates protocol health status.
 * @dev Health is derived from bad debt ratio versus total assets.
 */
library HealthLib {
    uint256 private constant BPS = 10000;

    function updateProtocolHealth(uint256 totalAssets, DataTypes.ProtocolHealthState storage ph) external {
        ph.isHealthy = totalAssets > 0
            ? ph.totalBadDebt <= (totalAssets * DataTypes.MAX_BAD_DEBT_RATIO_BPS) / BPS
            : true;
        ph.lastHealthCheck = uint64(block.timestamp);
    }
}
