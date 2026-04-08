// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test-only vault that always reverts on repay to hit LiquidationLib.RepayFailed.
contract MockVaultRevertingRepay {
    function repay(uint256, address, bool, int256) external pure {
        revert("mock repay fail");
    }

    function coverBadDebt(uint256 amount, uint256) external pure returns (uint256 covered) {
        return amount;
    }

    function receiveFees(uint256) external pure {}
}
