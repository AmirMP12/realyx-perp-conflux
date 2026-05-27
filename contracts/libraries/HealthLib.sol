// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "../interfaces/IVaultCore.sol";

/**
 * @title HealthLib
 * @notice Computes and updates protocol health status.
 * @dev Health is derived from net (uncovered) bad debt versus total assets, where insurance reserves
 *      are netted against the gross bad debt counter .
 */
library HealthLib {
    uint256 private constant BPS = 10000;

    /// @notice Update health using vault TVL only (legacy path, used when insurance is unknown).
    function updateProtocolHealth(uint256 totalAssets, DataTypes.ProtocolHealthState storage ph) external {
        uint256 net = ph.totalBadDebt;
        ph.isHealthy = totalAssets > 0
            ? net <= (totalAssets * DataTypes.MAX_BAD_DEBT_RATIO_BPS) / BPS
            : true;
        ph.lastHealthCheck = uint64(block.timestamp);
    }

    /// @notice Update health netting insurance assets against the gross bad debt counter .
    /// @dev Bad debt that has been covered by the insurance pool no longer threatens LP solvency
    /// until insurance is depleted. We therefore consider the *uncovered* portion against TVL.
    function updateProtocolHealthWithInsurance(
        uint256 totalAssets,
        uint256 insuranceAssets,
        DataTypes.ProtocolHealthState storage ph
    ) external {
        uint256 gross = ph.totalBadDebt;
        uint256 net = gross > insuranceAssets ? gross - insuranceAssets : 0;
        ph.isHealthy = totalAssets > 0
            ? net <= (totalAssets * DataTypes.MAX_BAD_DEBT_RATIO_BPS) / BPS
            : true;
        ph.lastHealthCheck = uint64(block.timestamp);
    }
}
