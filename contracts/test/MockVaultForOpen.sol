// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Configurable vault stand-in for driving TradingLib._executeIncrease.
///         `borrow` can be toggled to fail so the InsufficientLiquidity branch
///         is reachable; fee/rebate hooks pull USDC (matching the real vault's
///         funds-arrived invariant) so the distribute path succeeds.
contract MockVaultForOpen {
    bool public borrowSucceeds = true;

    function setBorrowSucceeds(bool v) external {
        borrowSucceeds = v;
    }

    function borrow(uint256, address, bool) external view returns (bool) {
        return borrowSucceeds;
    }

    function receiveLpFees(uint256) external {}

    function receiveFees(uint256) external {}

    function accrueRebate(address, uint256) external {}

    function repay(uint256, address, bool, int256) external {}

    function coverBadDebt(uint256, uint256) external pure returns (uint256) {
        return 0;
    }

    address private _usdc;

    function setUsdc(address u) external {
        _usdc = u;
    }
}
