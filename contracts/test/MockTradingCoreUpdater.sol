// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockTradingCoreUpdater {
    uint8 public mode; // 0=success, 1=revert(string), 2=revert(custom)

    error UpdateFailed();

    function setMode(uint8 m) external {
        mode = m;
    }

    function updatePositionOwner(uint256, address, address) external view {
        if (mode == 1) require(false, "mock update failed");
        if (mode == 2) revert UpdateFailed();
    }
}
