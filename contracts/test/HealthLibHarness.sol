// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/HealthLib.sol";
import "../libraries/DataTypes.sol";

contract HealthLibHarness {
    DataTypes.ProtocolHealthState public ph;

    function setBadDebt(uint256 badDebt) external {
        ph.totalBadDebt = badDebt;
    }

    function update(uint256 totalAssets) external {
        HealthLib.updateProtocolHealth(totalAssets, ph);
    }

    function getState() external view returns (bool, uint256, uint64) {
        return (ph.isHealthy, ph.totalBadDebt, ph.lastHealthCheck);
    }
}
