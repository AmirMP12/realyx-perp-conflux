// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/EmergencyPauseLib.sol";
import "../libraries/DataTypes.sol";

contract EmergencyPauseLibHarness {
    mapping(bytes32 => EmergencyPauseLib.PauseProposal) public pauseProposals;
    mapping(address => bool) public pausables;
    mapping(address => bool) public failedTargets;
    address[] public failedList;

    uint256 public guardianQuorum = 2;

    function setGuardianQuorum(uint256 _quorum) external {
        guardianQuorum = _quorum;
    }

    function setPausable(address target, bool isPausable) external {
        pausables[target] = isPausable;
    }

    function proposeEmergencyPause(address[] calldata targets) external returns (bytes32 pauseId) {
        return EmergencyPauseLib.proposeEmergencyPause(targets, pauseProposals);
    }

    function confirmEmergencyPause(bytes32 pauseId) external {
        EmergencyPauseLib.confirmEmergencyPause(
            pauseId,
            guardianQuorum,
            pauseProposals,
            pausables,
            failedTargets,
            failedList
        );
    }

    function getProposal(
        bytes32 pauseId
    )
        external
        view
        returns (address proposer, uint256 confirmations, uint256 timestamp, bool executed, uint256 targetsLength)
    {
        EmergencyPauseLib.PauseProposal storage p = pauseProposals[pauseId];
        return (p.proposer, p.confirmations, p.timestamp, p.executed, p.targets.length);
    }

    function hasConfirmed(bytes32 pauseId, address guardian) external view returns (bool) {
        return pauseProposals[pauseId].hasConfirmed[guardian];
    }

    function getFailedList() external view returns (address[] memory) {
        return failedList;
    }

    function isFailedTarget(address target) external view returns (bool) {
        return failedTargets[target];
    }
}
