// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/EmergencyPriceLib.sol";
import "../libraries/DataTypes.sol";
import "../interfaces/IOracleAggregator.sol";

contract EmergencyPriceLibHarness {
    mapping(bytes32 => EmergencyPriceLib.EmergencyPriceProposal) public emergencyPriceProposals;
    mapping(address => mapping(address => uint256)) public lastProposalAt;
    mapping(address => uint256) public manualPrices;
    mapping(address => uint256) public manualPriceExpiry;
    mapping(address => EmergencyPriceLib.PendingPriceOverride) public pendingManualPrices;

    uint256 public emergencyPriceQuorum = 2;
    address public oracleAggregator;

    function setOracleAggregator(address _oracle) external {
        oracleAggregator = _oracle;
    }

    function setEmergencyPriceQuorum(uint256 _quorum) external {
        emergencyPriceQuorum = _quorum;
    }

    function proposeEmergencyPrice(
        address collection,
        uint256 price,
        uint256 validUntil,
        uint256 nonce,
        uint256 minIntervalSeconds
    ) external returns (bytes32 proposalId) {
        return
            EmergencyPriceLib.proposeEmergencyPrice(
                collection,
                price,
                validUntil,
                nonce,
                emergencyPriceProposals,
                lastProposalAt,
                minIntervalSeconds
            );
    }

    function confirmEmergencyPrice(bytes32 proposalId) external {
        EmergencyPriceLib.confirmEmergencyPrice(
            proposalId,
            emergencyPriceQuorum,
            emergencyPriceProposals,
            manualPrices,
            manualPriceExpiry,
            pendingManualPrices,
            oracleAggregator
        );
    }

    function applyPendingEmergencyPrice(address collection) external {
        EmergencyPriceLib.applyPendingEmergencyPrice(
            collection,
            manualPrices,
            manualPriceExpiry,
            pendingManualPrices,
            oracleAggregator
        );
    }

    function cancelPendingEmergencyPrice(address collection) external {
        EmergencyPriceLib.cancelPendingEmergencyPrice(collection, pendingManualPrices);
    }

    function getProposal(
        bytes32 proposalId
    )
        external
        view
        returns (
            address collection,
            uint256 price,
            uint256 validUntil,
            uint256 confirmations,
            uint256 timestamp,
            bool executed
        )
    {
        EmergencyPriceLib.EmergencyPriceProposal storage p = emergencyPriceProposals[proposalId];
        return (p.collection, p.price, p.validUntil, p.confirmations, p.timestamp, p.executed);
    }

    function hasConfirmed(bytes32 proposalId, address guardian) external view returns (bool) {
        return emergencyPriceProposals[proposalId].hasConfirmed[guardian];
    }

    function getPendingOverride(
        address collection
    ) external view returns (uint256 price, uint256 validUntil, uint256 effectiveTime) {
        EmergencyPriceLib.PendingPriceOverride storage p = pendingManualPrices[collection];
        return (p.price, p.validUntil, p.effectiveTime);
    }
}
