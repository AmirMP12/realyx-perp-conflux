// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title RateLimitLib
 * @notice Rate limit check for large actions
 */
library RateLimitLib {
    error RateLimitExceeded();

    function checkAndUpdate(
        uint256 size,
        uint256 threshold,
        uint256 interval,
        uint256 blockTimestamp,
        mapping(address => uint256) storage lastLargeActionTime
    ) external {
        if (size >= threshold && blockTimestamp < lastLargeActionTime[msg.sender] + interval) {
            revert RateLimitExceeded();
        }
        if (size >= threshold) {
            lastLargeActionTime[msg.sender] = blockTimestamp;
        }
    }
}
