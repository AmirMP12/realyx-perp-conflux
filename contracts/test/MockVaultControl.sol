// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockVaultControl {
    uint256 public coverAmount;
    bool public revertCover;
    bool public revertRepay;

    function setCoverAmount(uint256 amount) external {
        coverAmount = amount;
    }

    function setRevertCover(bool flag) external {
        revertCover = flag;
    }

    function setRevertRepay(bool flag) external {
        revertRepay = flag;
    }

    function coverBadDebt(uint256 amount, uint256) external view returns (uint256) {
        if (revertCover) revert("cover-fail");
        return coverAmount > amount ? amount : coverAmount;
    }

    function repay(uint256, address, bool, int256) external view {
        if (revertRepay) revert("repay-fail");
    }

    function receiveFees(uint256) external pure {}
}
