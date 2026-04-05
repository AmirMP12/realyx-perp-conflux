// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title FlashLoanCheck
 * @notice Library for flash-loan and rate-limit checks
 */
library FlashLoanCheck {
    error FlashLoanDetected();
    error RateLimitExceeded();

    function validateFlashLoan(
        address sender,
        address origin,
        uint256 blockNumber,
        uint256 blockTimestamp,
        bool isOperator,
        uint256 maxActionsPerBlock,
        uint256 minInteractionDelay,
        mapping(address => uint256) storage lastInteractionBlock,
        mapping(address => bool) storage trustedForwarders,
        uint256 lastGlobalInteractionBlock,
        uint256 globalBlockInteractions,
        mapping(address => uint256) storage lastInteractionTimestamp
    ) external returns (uint256 newLastGlobalInteractionBlock, uint256 newGlobalBlockInteractions) {
        if (lastInteractionBlock[sender] == blockNumber) revert FlashLoanDetected();
        lastInteractionBlock[sender] = blockNumber;

        if (sender != origin && !trustedForwarders[sender]) {
            revert FlashLoanDetected();
        }

        if (lastGlobalInteractionBlock != blockNumber) {
            newLastGlobalInteractionBlock = blockNumber;
            newGlobalBlockInteractions = 1;
        } else {
            newLastGlobalInteractionBlock = lastGlobalInteractionBlock;
            unchecked { newGlobalBlockInteractions = globalBlockInteractions + 1; }
            if (maxActionsPerBlock > 0 && newGlobalBlockInteractions > maxActionsPerBlock) {
                revert RateLimitExceeded();
            }
        }

        uint256 codeSize;
        assembly { codeSize := extcodesize(sender) }
        if (codeSize > 0 && !isOperator) {
            revert FlashLoanDetected();
        }

        if (minInteractionDelay > 0) {
            if (blockTimestamp < lastInteractionTimestamp[sender] + minInteractionDelay) {
                revert RateLimitExceeded();
            }
            lastInteractionTimestamp[sender] = blockTimestamp;
        }
    }
}
