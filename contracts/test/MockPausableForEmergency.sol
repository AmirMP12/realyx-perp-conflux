// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mock pausable contract for testing emergency pause
contract MockPausableForEmergency {
    bool public paused;

    function pause() external {
        paused = true;
    }

    function unpause() external {
        paused = false;
    }
}

/// @notice Mock pausable that reverts on pause() call
contract MockPausableRevertOnPause {
    function pause() external pure {
        revert("pause failed");
    }
}
