// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/Events.sol";
import "../interfaces/IOracleAggregator.sol";

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
    /// @dev standard guardian-quorum approvals stage the price for 24h before going live.
    uint256 internal constant PRICE_OVERRIDE_DELAY = 24 hours;
    /// @dev fast-track override only for tight deviations and a super-majority quorum.
    uint256 internal constant FAST_TRACK_DEVIATION_BPS = 300;
    uint256 internal constant FAST_TRACK_QUORUM_MULTIPLIER = 2;

    error EmergencyPriceProposalNotFound();
    error EmergencyPriceAlreadyConfirmed();
    error EmergencyPriceProposalExpired();
    error AlreadyConfirmed();
    error EmergencyPriceDeviationTooHigh();
    error ProposalAlreadyExists();
    error PendingOverrideTimelockActive();
    error NoPendingOverride();

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

        // Use the typed interface so a malformed/stale oracle reverts
        //             explicitly. The proposal stays `executed=true` but no
        //             override is staged or applied; guardians can re-submit
        //             once the oracle recovers.
        try IOracleAggregator(oracleAggregator).getPrice(proposal.collection) returns (
            uint256 p,
            uint256,
            uint256
        ) {
            refPrice = p;
            hasRefPrice = refPrice > 0;
        } catch {
            // Leave hasRefPrice=false; falls into the absolute-bound + 2x-quorum branch below.
        }

        // enforce a real timelock between guardian quorum and price application,
        // with a fast-track only for tight deviations + super-majority quorum.
        bool fastTrack = false;
        if (hasRefPrice) {
            uint256 delta = proposal.price > refPrice ? proposal.price - refPrice : refPrice - proposal.price;
            uint256 devBps = (delta * BPS) / refPrice;
            if (devBps > MAX_EMERGENCY_PRICE_DEVIATION_BPS) {
                revert EmergencyPriceDeviationTooHigh();
            }
            if (
                devBps <= FAST_TRACK_DEVIATION_BPS &&
                proposal.confirmations >= emergencyPriceQuorum * FAST_TRACK_QUORUM_MULTIPLIER
            ) {
                fastTrack = true;
            }
        } else {
            if (proposal.confirmations < emergencyPriceQuorum * FAST_TRACK_QUORUM_MULTIPLIER) {
                revert EmergencyPriceDeviationTooHigh();
            }
            if (proposal.price > MAX_EMERGENCY_PRICE_ABSOLUTE) {
                revert EmergencyPriceDeviationTooHigh();
            }
        }

        if (fastTrack) {
            // Apply now; override is live immediately.
            manualPrices[proposal.collection] = proposal.price;
            manualPriceExpiry[proposal.collection] = proposal.validUntil;
            delete pendingManualPrices[proposal.collection];
            emit PriceOverrideExecuted(proposal.collection, proposal.price);
            emit EmergencyPriceApplied(proposal.collection, proposal.price, refPrice);
        } else {
            // Stage the override; `applyPendingEmergencyPrice` will activate it after the timelock.
            pendingManualPrices[proposal.collection] = PendingPriceOverride({
                price: proposal.price,
                validUntil: proposal.validUntil,
                effectiveTime: block.timestamp + PRICE_OVERRIDE_DELAY
            });
            emit EmergencyPriceProposed(bytes32(0), proposal.collection, proposal.price, address(this));
        }
    }

    /// @notice Promote a staged emergency price override into the live `manualPrices` map after the timelock has elapsed.
    /// @dev Permissionless: stable identity is the staged proposal; reverts when nothing is pending or timelock not yet expired.
    function applyPendingEmergencyPrice(
        address collection,
        mapping(address => uint256) storage manualPrices,
        mapping(address => uint256) storage manualPriceExpiry,
        mapping(address => PendingPriceOverride) storage pendingManualPrices
    ) internal {
        PendingPriceOverride storage pending = pendingManualPrices[collection];
        if (pending.effectiveTime == 0) revert NoPendingOverride();
        if (block.timestamp < pending.effectiveTime) revert PendingOverrideTimelockActive();

        uint256 price = pending.price;
        uint256 validUntil = pending.validUntil;
        delete pendingManualPrices[collection];

        manualPrices[collection] = price;
        manualPriceExpiry[collection] = validUntil;
        emit PriceOverrideExecuted(collection, price);
    }

    /// @notice Cancel a staged emergency price override (before activation).
    function cancelPendingEmergencyPrice(
        address collection,
        mapping(address => PendingPriceOverride) storage pendingManualPrices
    ) internal {
        if (pendingManualPrices[collection].effectiveTime == 0) revert NoPendingOverride();
        delete pendingManualPrices[collection];
    }
}
