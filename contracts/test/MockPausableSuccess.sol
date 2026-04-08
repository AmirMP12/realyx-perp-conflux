// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockPausableSuccess {
    bool public paused;

    function pause() external {
        paused = true;
    }
}
