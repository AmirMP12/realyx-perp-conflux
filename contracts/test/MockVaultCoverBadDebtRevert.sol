// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test-only vault for PositionCloseLib catch branch.
contract MockVaultCoverBadDebtRevert {
    function borrow(uint256, address, bool) external pure returns (bool success) {
        return true;
    }

    function repay(uint256, address, bool, int256) external pure {
        // no-op so close flow can continue beyond repay
    }

    function coverBadDebt(uint256, uint256) external pure returns (uint256) {
        revert("mock cover fail");
    }

    function receiveFees(uint256) external pure {}
}
