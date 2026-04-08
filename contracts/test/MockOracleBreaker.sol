// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal oracle stub for tests: toggles `isActionAllowed` (breaker simulation).
contract MockOracleBreaker {
    bool public allow = true;

    function setAllow(bool a) external {
        allow = a;
    }

    function isActionAllowed(address, uint8) external view returns (bool) {
        return allow;
    }
}
