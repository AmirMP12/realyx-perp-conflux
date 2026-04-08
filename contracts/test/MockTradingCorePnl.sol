// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockTradingCorePnl {
    int256 public pnl;
    bool public shouldRevert;

    function setPnl(int256 p) external {
        pnl = p;
    }

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function getGlobalUnrealizedPnL() external view returns (int256) {
        if (shouldRevert) revert("mock pnl revert");
        return pnl;
    }
}
