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
    /// @dev Tightened from 30% to 5%. A guardian quorum must not be able
    ///      to pin a price 30% off Pyth and trigger one-sided mass
    ///      liquidations. Anything beyond a sane intra-day move requires a
    ///      coordinated admin / governance response.
    uint256 private constant MAX_EMERGENCY_PRICE_DEVIATION_BPS = 500;
    /// @dev Removed the unbounded "no-Pyth-reference" absolute cap (1e24).
    ///      When Pyth is unreachable we now refuse to apply any override —
    ///      guardians must wait for oracle recovery or use the staged path
    ///      with admin re-confirmation.
    uint256 internal constant PRICE_OVERRIDE_DELAY = 24 hours;
    /// @dev fast-track override only for tight deviations and a super-majority quorum.
    uint256 internal constant FAST_TRACK_DEVIATION_BPS = 100;
    uint256 internal constant FAST_TRACK_QUORUM_MULTIPLIER = 2;

    error EmergencyPriceProposalNotFound();
    error EmergencyPriceAlreadyConfirmed();
    error EmergencyPriceProposalExpired();
    error AlreadyConfirmed();
    error EmergencyPriceDeviationTooHigh();
    error ProposalAlreadyExists();
    error PendingOverrideTimelockActive();
    error NoPendingOverride();
    /// @dev Refuse to apply an override when the on-chain oracle is
    ///      unreachable. Without a reference price the deviation guard is
    ///      meaningless and the override would be unbounded.
    error OracleUnreachableForOverride();
    /// @dev Emergency price `validUntil` must be bounded; otherwise a
    ///      guardian quorum could pin a price for years.
    error EmergencyPriceValidUntilOutOfRange();

    /// @dev Maximum window an emergency price override can stay active.
    ///      A guardian quorum that wants to keep the override beyond this must
    ///      submit a fresh proposal. Bounded to 7 days.
    uint256 internal constant MAX_EMERGENCY_PRICE_WINDOW = 7 days;

    function proposeEmergencyPrice(
        address collection,
        uint256 price,
        uint256 validUntil,
        uint256 nonce,
        mapping(bytes32 => EmergencyPriceProposal) storage emergencyPriceProposals,
        mapping(address => mapping(address => uint256)) storage lastProposalAt,
        uint256 minIntervalSeconds
    ) internal returns (bytes32 proposalId) {
        // Bound the override window. `validUntil` must be in the future and
        // no further than `MAX_EMERGENCY_PRICE_WINDOW` from now.
        if (validUntil <= block.timestamp || validUntil > block.timestamp + MAX_EMERGENCY_PRICE_WINDOW) {
            revert EmergencyPriceValidUntilOutOfRange();
        }

        // Per-guardian per-market rate limit. Without this, a single
        // guardian can fill the proposals storage with cheap proposals
        // (each unique nonce) and effectively keep an override pinned by
        // refreshing it every `validUntil` window.
        if (
            minIntervalSeconds > 0 &&
            block.timestamp < lastProposalAt[msg.sender][collection] + minIntervalSeconds
        ) {
            revert ProposalAlreadyExists();
        }
        lastProposalAt[msg.sender][collection] = block.timestamp;

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
            // Leave hasRefPrice=false; the no-refprice branch below now
            // refuses to apply any override.
        }

        // Refuse to apply when no reference price is available.
        // The previous absolute-bound + 2x-quorum branch silently allowed
        // up to 1e24 with no oracle sanity check — replaced with a hard
        // refusal. Guardians must wait for Pyth recovery or stage via the
        // (still-timelocked) pending override path.
        if (!hasRefPrice) {
            revert OracleUnreachableForOverride();
        }

        bool fastTrack = false;
        {
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
    /// @dev Re-validates the deviation against Pyth at apply time so a price
    ///      that was reasonable when proposed cannot be applied days later
    ///      against a vastly-moved oracle.
    function applyPendingEmergencyPrice(
        address collection,
        mapping(address => uint256) storage manualPrices,
        mapping(address => uint256) storage manualPriceExpiry,
        mapping(address => PendingPriceOverride) storage pendingManualPrices,
        address oracleAggregator
    ) internal {
        PendingPriceOverride storage pending = pendingManualPrices[collection];
        if (pending.effectiveTime == 0) revert NoPendingOverride();
        if (block.timestamp < pending.effectiveTime) revert PendingOverrideTimelockActive();

        // Re-validate against the live oracle. If Pyth is unreachable at
        // apply time, refuse — guardians can either re-stage or cancel.
        uint256 refPrice;
        try IOracleAggregator(oracleAggregator).getPrice(collection) returns (uint256 p, uint256, uint256) {
            refPrice = p;
        } catch {
            revert OracleUnreachableForOverride();
        }
        if (refPrice == 0) revert OracleUnreachableForOverride();

        uint256 delta = pending.price > refPrice ? pending.price - refPrice : refPrice - pending.price;
        uint256 devBps = (delta * BPS) / refPrice;
        if (devBps > MAX_EMERGENCY_PRICE_DEVIATION_BPS) revert EmergencyPriceDeviationTooHigh();

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
