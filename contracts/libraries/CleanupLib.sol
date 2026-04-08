// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";

/**
 * @title CleanupLib
 * @notice Position cleanup
 */
library CleanupLib {
    function cleanupPositions(
        uint256[] storage positions,
        mapping(uint256 => DataTypes.Position) storage positionData,
        mapping(uint256 => DataTypes.PositionCollateral) storage positionCollateral,
        uint256 maxCleanup
    ) external returns (uint256 cleaned) {
        uint256 i;
        uint256 len = positions.length;
        while (i < len && cleaned < maxCleanup) {
            if (positionData[positions[i]].state != DataTypes.PosStatus.OPEN) {
                uint256 posId = positions[i];
                delete positionData[posId];
                delete positionCollateral[posId];
                positions[i] = positions[len - 1];
                positions.pop();
                len--;
                unchecked {
                    ++cleaned;
                }
            } else {
                unchecked {
                    ++i;
                }
            }
        }
    }
}
