// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title RateLimitLib
 * @notice Rate limit check for large actions
 */
library RateLimitLib {
    error RateLimitExceeded();

    /// @notice Atomic check-and-update used by paths that own the enforcement window.
    ///         Reverts when `size >= threshold` and the actor's last large action is
    ///         within `interval`; on success, stamps `lastLargeActionTime[msg.sender]`.
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

    /// @notice Read-only variant. Order-creation should *check* the
    ///         rate-limit budget without consuming it; consumption happens at
    ///         execution time when the order actually opens a position. Keying
    ///         on a passed-in `actor` lets the keeper-side executor enforce the
    ///         limit against the *order owner*, not the keeper's own address.
    function checkOnly(
        address actor,
        uint256 size,
        uint256 threshold,
        uint256 interval,
        uint256 blockTimestamp,
        mapping(address => uint256) storage lastLargeActionTime
    ) external view {
        if (size >= threshold && blockTimestamp < lastLargeActionTime[actor] + interval) {
            revert RateLimitExceeded();
        }
    }

    /// @notice Atomic check-and-update keyed on an explicit `actor` address.
    ///         Used by execute paths so the budget is consumed against the
    ///         order owner instead of `msg.sender` (the keeper).
    function checkAndUpdateFor(
        address actor,
        uint256 size,
        uint256 threshold,
        uint256 interval,
        uint256 blockTimestamp,
        mapping(address => uint256) storage lastLargeActionTime
    ) external {
        if (size >= threshold && blockTimestamp < lastLargeActionTime[actor] + interval) {
            revert RateLimitExceeded();
        }
        if (size >= threshold) {
            lastLargeActionTime[actor] = blockTimestamp;
        }
    }
}
