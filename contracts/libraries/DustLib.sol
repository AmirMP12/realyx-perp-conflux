// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./DataTypes.sol";

/**
 * @title DustLib
 * @notice Handles sweeping accumulated dust balances to treasury.
 * @dev Converts internal precision dust into token precision before transfer.
 */
library DustLib {
    using SafeERC20 for IERC20;

    function sweepDust(
        IERC20 usdc,
        address treasury,
        DataTypes.DustAccumulator storage dust
    ) external returns (uint256 swept) {
        swept = dust.totalDust / DataTypes.DECIMAL_CONVERSION;
        if (swept > 0) {
            dust.totalDust = 0;
            dust.lastSweepTimestamp = block.timestamp;
            usdc.safeTransfer(treasury, swept);
        }
    }
}
