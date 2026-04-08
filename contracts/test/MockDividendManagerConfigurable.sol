// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IDividendManager.sol";

/// @notice Configurable dividend manager mock to drive TradingLib dividend branches.
contract MockDividendManagerConfigurable is IDividendManager {
    int256 public settleAmount;
    uint256 public settleIndex;

    function setSettleResult(int256 amount, uint256 newIndex) external {
        settleAmount = amount;
        settleIndex = newIndex;
    }

    function distributeDividend(string calldata, uint256) external override {}

    function getDividendIndex(string calldata) external pure override returns (uint256) {
        return 0;
    }

    function settleDividends(
        uint256,
        string calldata,
        uint256,
        bool,
        uint256
    ) external view override returns (int256 dividendAmount, uint256 newIndex) {
        return (settleAmount, settleIndex);
    }

    function getUnsettledDividends(string calldata, uint256, bool, uint256) external pure override returns (int256) {
        return 0;
    }
}
