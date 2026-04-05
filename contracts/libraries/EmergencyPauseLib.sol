// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title EmergencyPauseLib
 * @notice Library for emergency pause operations
 */
library EmergencyPauseLib {
    struct PauseProposal {
        address proposer;
        address[] targets;
        uint256 confirmations;
        uint256 timestamp;
        bool executed;
        mapping(address => bool) hasConfirmed;
    }
    uint256 private constant PROPOSAL_EXPIRY = 1 hours;
    uint256 private constant PAUSE_GAS_LIMIT = 100000;
    
    error ProposalNotFound();
    error ProposalExpired();
    error AlreadyConfirmed();
    
    event EmergencyPauseProposed(bytes32 indexed pauseId, address indexed proposer, address[] targets);
    event EmergencyPauseExecuted(bytes32 indexed pauseId, address[] targets);
    event EmergencyPauseTargetFailed(bytes32 indexed pauseId, address indexed target);
    event GlobalPauseActivated(address indexed by);
    event GlobalPauseDeactivated(address indexed by);
    
    
    function proposeEmergencyPause(
        address[] calldata targets,
        mapping(bytes32 => EmergencyPauseLib.PauseProposal) storage pauseProposals
    ) external returns (bytes32 pauseId) {
        pauseId = keccak256(abi.encode(targets, block.timestamp, msg.sender));
        PauseProposal storage proposal = pauseProposals[pauseId];
        proposal.proposer = msg.sender;
        proposal.targets = targets;
        proposal.confirmations = 1;
        proposal.timestamp = block.timestamp;
        proposal.hasConfirmed[msg.sender] = true;
        emit EmergencyPauseProposed(pauseId, msg.sender, targets);
    }
    
    function confirmEmergencyPause(
        bytes32 pauseId,
        uint256 guardianQuorum,
        mapping(bytes32 => EmergencyPauseLib.PauseProposal) storage pauseProposals,
        mapping(address => bool) storage pausables,
        mapping(address => bool) storage failedTargets,
        address[] storage failedList
    ) external {
        EmergencyPauseLib.PauseProposal storage proposal = pauseProposals[pauseId];
        if (proposal.proposer == address(0)) revert ProposalNotFound();
        if (proposal.executed) revert ProposalExpired();
        if (block.timestamp > proposal.timestamp + PROPOSAL_EXPIRY) revert ProposalExpired();
        if (proposal.hasConfirmed[msg.sender]) revert AlreadyConfirmed();
        
        proposal.hasConfirmed[msg.sender] = true;
        unchecked { ++proposal.confirmations; }
        
        if (proposal.confirmations >= guardianQuorum) {
            _executeEmergencyPause(pauseId, proposal, pausables, failedTargets, failedList);
        }
    }
    
    function _executeEmergencyPause(
        bytes32 pauseId,
        EmergencyPauseLib.PauseProposal storage proposal,
        mapping(address => bool) storage pausables,
        mapping(address => bool) storage failedTargets,
        address[] storage failedList
    ) private {
        proposal.executed = true;
        while (failedList.length > 0) {
            failedList.pop();
        }
        
        uint256 len = proposal.targets.length;
        for (uint256 i = 0; i < len;) {
            address target = proposal.targets[i];
            if (pausables[target]) {
                (bool success,) = target.call{gas: PAUSE_GAS_LIMIT}(
                    abi.encodeWithSignature("pause()")
                );
                if (!success) {
                    failedTargets[target] = true;
                    failedList.push(target);
                    emit EmergencyPauseTargetFailed(pauseId, target);
                }
            }
            unchecked { ++i; }
        }
        emit EmergencyPauseExecuted(pauseId, proposal.targets);
    }
}
