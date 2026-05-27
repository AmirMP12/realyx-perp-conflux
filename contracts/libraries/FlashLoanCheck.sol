// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title FlashLoanCheck
 * @notice Same-block / rate-limit guard against flash-loan-style abuse.
 * @dev removed the blanket `extcodesize > 0` and `tx.origin != msg.sender` rejections so
 *      that smart-account wallets (Safe, ERC-4337, EIP-7702) and trusted ERC-2771 forwarders are
 *      compatible by default. Replay protection still relies on the same-block per-sender lock,
 *      `maxActionsPerBlock` global cap and `minInteractionDelay`. Operators are exempted as before.
 */
library FlashLoanCheck {
    error FlashLoanDetected();
    error RateLimitExceeded();

    function validateFlashLoan(
        address sender,
        address /* origin */,
        uint256 blockNumber,
        uint256 blockTimestamp,
        bool isOperator,
        uint256 maxActionsPerBlock,
        uint256 minInteractionDelay,
        mapping(address => uint256) storage lastInteractionBlock,
        mapping(address => bool) storage /* trustedForwarders */,
        uint256 lastGlobalInteractionBlock,
        uint256 globalBlockInteractions,
        mapping(address => uint256) storage lastInteractionTimestamp
    ) external returns (uint256 newLastGlobalInteractionBlock, uint256 newGlobalBlockInteractions) {
        // skip same-block lock for operators so admin/keeper batched flows do not
        // self-DoS within a single transaction.
        if (!isOperator) {
            if (lastInteractionBlock[sender] == blockNumber) revert FlashLoanDetected();
            lastInteractionBlock[sender] = blockNumber;
        }

        if (lastGlobalInteractionBlock != blockNumber) {
            newLastGlobalInteractionBlock = blockNumber;
            newGlobalBlockInteractions = 1;
        } else {
            newLastGlobalInteractionBlock = lastGlobalInteractionBlock;
            unchecked {
                newGlobalBlockInteractions = globalBlockInteractions + 1;
            }
            if (maxActionsPerBlock > 0 && newGlobalBlockInteractions > maxActionsPerBlock) {
                revert RateLimitExceeded();
            }
        }

        // Per-sender minimum delay is the actual flash-loan defence (atomic same-block double-call).
        if (minInteractionDelay > 0 && !isOperator) {
            if (blockTimestamp < lastInteractionTimestamp[sender] + minInteractionDelay) {
                revert RateLimitExceeded();
            }
            lastInteractionTimestamp[sender] = blockTimestamp;
        }
    }
}
