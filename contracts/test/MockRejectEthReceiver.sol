// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mock receiver that rejects plain ETH transfers.
contract MockRejectEthReceiver {
    receive() external payable {
        revert();
    }
}
