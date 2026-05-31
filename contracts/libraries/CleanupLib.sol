// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";

/**
 * @title CleanupLib
 * @notice Position cleanup
 */
library CleanupLib {
    /// @notice Remove stale CLOSED (and, for non-admin self-cleanup,
    ///         LIQUIDATED) position ids from a user's enumeration, capped
    ///         to `maxCleanup`.
    /// @dev Refuses to remove an id that still has an unresolved
    ///      `FailedRepayment` record so the residual is recoverable via
    ///      `resolveFailedRepayment`. Admin path additionally refuses to
    ///      delete `LIQUIDATED` positions to preserve the audit trail.
    function cleanupPositions(
        uint256[] storage positions,
        mapping(uint256 => DataTypes.Position) storage positionData,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        uint256 maxCleanup,
        mapping(uint256 => DataTypes.FailedRepayment) storage failedRepayments,
        bool adminPath
    ) external returns (uint256 cleaned) {
        uint256 i;
        uint256 len = positions.length;
        while (i < len && cleaned < maxCleanup) {
            uint256 posId = positions[i];
            DataTypes.PosStatus state = positionData[posId].state;

            // Only purge fully-resolved positions.
            bool eligible = state == DataTypes.PosStatus.CLOSED;
            // For self-cleanup, allow LIQUIDATED too. For admin-driven
            // bulk cleanup, preserve LIQUIDATED records as audit trail.
            if (!adminPath && state == DataTypes.PosStatus.LIQUIDATED) {
                eligible = true;
            }
            // Refuse to clean ids with an unresolved failed-repayment
            // record so the residual is still resolvable via
            // `resolveFailedRepayment`.
            if (eligible) {
                DataTypes.FailedRepayment storage fr = failedRepayments[posId];
                if (fr.amount > 0 && !fr.resolved) {
                    eligible = false;
                }
            }

            if (eligible && state != DataTypes.PosStatus.OPEN) {
                delete positionData[posId];
                delete positionCollateral[posId];
                positions[i] = positions[len - 1];
                positions.pop();
                len--;
                unchecked {
                    ++cleaned;
                }
                // NOTE: `i` is intentionally NOT advanced here.
                //       The element just swapped into slot `i` must be
                //       re-evaluated on the next loop iteration.
            } else {
                unchecked {
                    ++i;
                }
            }
        }
    }
}
