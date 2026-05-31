// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title WithdrawLib
 * @notice Handles keeper fee and order refund withdrawals.
 * @dev Uses ETH sends for fee/refund balances and token transfer for collateral refunds.
 *      ETH transfers use `call{value, gas}` capped at `MAX_REFUND_GAS` so a
 *      malicious recipient cannot grief other callers via unbounded gas use; the
 *      caller-side `nonReentrant` already mitigates re-entry. Smart-account wallets that
 *      consume more than 50k gas in their `receive()` should pull via a specialized path.
 */
library WithdrawLib {
    using SafeERC20 for IERC20;

    uint256 private constant MAX_REFUND_GAS = 200000;

    error TransferFailed();

    function withdrawKeeperFees(mapping(address => uint256) storage balance, address sender) external {
        uint256 amount = balance[sender];
        if (amount == 0) return;
        balance[sender] = 0;
        (bool ok, ) = payable(sender).call{value: amount, gas: MAX_REFUND_GAS}("");
        if (!ok) revert TransferFailed();
    }

    function withdrawOrderRefund(mapping(address => uint256) storage balance, address sender) external {
        uint256 amount = balance[sender];
        if (amount == 0) return;
        balance[sender] = 0;
        (bool ok, ) = payable(sender).call{value: amount, gas: MAX_REFUND_GAS}("");
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

    function withdrawOrderCollateralTokenRefund(
        mapping(address => mapping(address => uint256)) storage balanceByToken,
        address sender,
        address token
    ) external {
        uint256 amount = balanceByToken[sender][token];
        if (amount == 0) return;
        balanceByToken[sender][token] = 0;
        IERC20(token).safeTransfer(sender, amount);
    }
}
