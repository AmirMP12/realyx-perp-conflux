// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal mock that always reverts ownerOf.
contract MockPositionTokenRevertOwner {
    function ownerOf(uint256) external pure returns (address) {
        revert("no-owner");
    }
}
