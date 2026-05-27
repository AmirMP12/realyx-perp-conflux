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

    /// @dev Gas stipend forwarded to externally-controlled accounts on ETH refund.
    ///      Tuned to comfortably cover Safe / ERC-4337 receive handlers (~30-40k)
    ///      plus headroom. Larger consumers must withdraw via the dedicated
    ///      `withdrawWithGas` path (not implemented here on purpose – deliberate cap).
    uint256 private constant MAX_REFUND_GAS = 50000;

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
}
