// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/Events.sol";

/**
 * @title EmergencyPriceLib
 * @notice Library for emergency price proposal operations
 */
library EmergencyPriceLib {
    struct EmergencyPriceProposal {
        address collection;
        uint256 price;
        uint256 validUntil;
        uint256 confirmations;
        uint256 timestamp;
        bool executed;
        mapping(address => bool) hasConfirmed;
    }

    struct PendingPriceOverride {
        uint256 price;
        uint256 validUntil;
        uint256 effectiveTime;
    }
    uint256 private constant BPS = 10000;
    uint256 private constant PROPOSAL_EXPIRY = 1 hours;
    uint256 private constant MAX_EMERGENCY_PRICE_DEVIATION_BPS = 3000;
    uint256 private constant MAX_EMERGENCY_PRICE_ABSOLUTE = 1e24;

    error EmergencyPriceProposalNotFound();
    error EmergencyPriceAlreadyConfirmed();
    error EmergencyPriceProposalExpired();
    error AlreadyConfirmed();
    error EmergencyPriceDeviationTooHigh();
    error ProposalAlreadyExists();

    function proposeEmergencyPrice(
        address collection,
        uint256 price,
        uint256 validUntil,
        uint256 nonce,
        mapping(bytes32 => EmergencyPriceProposal) storage emergencyPriceProposals
    ) internal returns (bytes32 proposalId) {
        proposalId = keccak256(
            abi.encode(collection, price, validUntil, block.timestamp, block.number, msg.sender, nonce)
        );

        EmergencyPriceProposal storage proposal = emergencyPriceProposals[proposalId];
        if (proposal.collection != address(0)) revert ProposalAlreadyExists();

        proposal.collection = collection;
        proposal.price = price;
        proposal.validUntil = validUntil;
        proposal.confirmations = 1;
        proposal.timestamp = block.timestamp;
        proposal.executed = false;
        proposal.hasConfirmed[msg.sender] = true;

        emit EmergencyPriceProposed(proposalId, collection, price, msg.sender);
    }

    function confirmEmergencyPrice(
        bytes32 proposalId,
        uint256 emergencyPriceQuorum,
        mapping(bytes32 => EmergencyPriceLib.EmergencyPriceProposal) storage emergencyPriceProposals,
        mapping(address => uint256) storage manualPrices,
        mapping(address => uint256) storage manualPriceExpiry,
        mapping(address => EmergencyPriceLib.PendingPriceOverride) storage pendingManualPrices,
        address oracleAggregator
    ) internal {
        EmergencyPriceProposal storage proposal = emergencyPriceProposals[proposalId];
        if (proposal.collection == address(0)) revert EmergencyPriceProposalNotFound();
        if (proposal.executed) revert EmergencyPriceAlreadyConfirmed();
        if (block.timestamp > proposal.timestamp + PROPOSAL_EXPIRY) revert EmergencyPriceProposalExpired();
        if (proposal.hasConfirmed[msg.sender]) revert AlreadyConfirmed();

        proposal.hasConfirmed[msg.sender] = true;
        unchecked {
            ++proposal.confirmations;
        }

        emit EmergencyPriceProposed(proposalId, proposal.collection, proposal.price, msg.sender);

        if (proposal.confirmations >= emergencyPriceQuorum) {
            _executeEmergencyPrice(
                proposalId,
                proposal,
                manualPrices,
                manualPriceExpiry,
                pendingManualPrices,
                emergencyPriceQuorum,
                oracleAggregator
            );
        }
    }

    function _executeEmergencyPrice(
        bytes32,
        EmergencyPriceLib.EmergencyPriceProposal storage proposal,
        mapping(address => uint256) storage manualPrices,
        mapping(address => uint256) storage manualPriceExpiry,
        mapping(address => PendingPriceOverride) storage pendingManualPrices,
        uint256 emergencyPriceQuorum,
        address oracleAggregator
    ) private {
        proposal.executed = true;

        uint256 refPrice = 0;
        bool hasRefPrice = false;

        (bool success, bytes memory data) = oracleAggregator.staticcall(
            abi.encodeWithSignature("getPrice(address)", proposal.collection)
        );
        if (success) {
            (refPrice, , ) = abi.decode(data, (uint256, uint256, uint256));
            hasRefPrice = refPrice > 0;
        }

        if (hasRefPrice) {
            uint256 delta = proposal.price > refPrice ? proposal.price - refPrice : refPrice - proposal.price;
            uint256 devBps = (delta * BPS) / refPrice;
            if (devBps > MAX_EMERGENCY_PRICE_DEVIATION_BPS) {
                revert EmergencyPriceDeviationTooHigh();
            }
        } else {
            if (proposal.confirmations < emergencyPriceQuorum * 2) {
                revert EmergencyPriceDeviationTooHigh();
            }
            if (proposal.price > MAX_EMERGENCY_PRICE_ABSOLUTE) {
                revert EmergencyPriceDeviationTooHigh();
            }
        }

        manualPrices[proposal.collection] = proposal.price;
        manualPriceExpiry[proposal.collection] = proposal.validUntil;

        pendingManualPrices[proposal.collection] = PendingPriceOverride({
            price: proposal.price,
            validUntil: proposal.validUntil,
            effectiveTime: block.timestamp
        });

        emit PriceOverrideExecuted(proposal.collection, proposal.price);
        emit EmergencyPriceApplied(proposal.collection, proposal.price, refPrice);
    }
}
