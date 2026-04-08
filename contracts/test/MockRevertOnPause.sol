// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Used to exercise EmergencyPauseLib when `pause()` fails the low-level call.
contract MockRevertOnPause {
    function pause() external pure {
        revert("no-pause");
    }
}
