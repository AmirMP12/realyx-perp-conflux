// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Library for keeper/order withdraw flows
library WithdrawLib {
    using SafeERC20 for IERC20;

    error TransferFailed();

    function withdrawKeeperFees(
        mapping(address => uint256) storage balance,
        address sender
    ) external {
        uint256 amount = balance[sender];
        if (amount == 0) return;
        balance[sender] = 0;
        (bool ok,) = payable(sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function withdrawOrderRefund(
        mapping(address => uint256) storage balance,
        address sender
    ) external {
        uint256 amount = balance[sender];
        if (amount == 0) return;
        balance[sender] = 0;
        (bool ok,) = payable(sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function withdrawOrderCollateralRefund(
        mapping(address => uint256) storage balance,
        address sender,
        IERC20 usdc
    ) external {
        uint256 amount = balance[sender];
        if (amount == 0) return;
        balance[sender] = 0;
        usdc.safeTransfer(sender, amount);
    }
}
