// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal oracle stub returning zero price to hit TradingCoreViews price==0 branch.
contract MockOracleZeroPrice {
    function getPrice(address) external pure returns (uint256, uint256, uint8) {
        return (0, 0, 0);
    }
}
