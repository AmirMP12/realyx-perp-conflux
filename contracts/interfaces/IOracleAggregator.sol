// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/Events.sol";

/**
 * @title IOracleAggregator
 * @notice Oracle facade: Pyth-based prices per `market` (collection) address, TWAP buffers, circuit breakers, emergency pause/price flows.
 * @dev `market` parameters are collection contract addresses keyed in oracle config; naming matches trading “market” tokens.
 */
interface IOracleAggregator {
    /**
     * @notice Latest normalized price, oracle confidence, and publish timestamp for `market`.
     * @param market Market/collection address.
     * @return price 1e18-scaled price when configured that way by normalization.
     * @return confidence Oracle-reported uncertainty in the same price scale family as implementation.
     * @return timestamp Source publish time (e.g. Pyth `publishTime`).
     * @dev May read manual/emergency override price when active and unexpired.
     */
    function getPrice(address market) external view returns (uint256 price, uint256 confidence, uint256 timestamp);

    /**
     * @notice Same as `getPrice` but reverts if oracle confidence exceeds `maxUncertainty`.
     * @param market Market/collection address.
     * @param maxUncertainty Maximum acceptable confidence bound; revert if higher.
     */
    function getPriceWithConfidence(address market, uint256 maxUncertainty) external view returns (uint256 price);

    /**
     * @notice Time-weighted average price over `windowSeconds` using the in-contract ring buffer.
     * @param market Market/collection address.
     * @param windowSeconds Lookback window length in seconds.
     */
    function getTWAP(address market, uint256 windowSeconds) external view returns (uint256 twapPrice);

    /**
     * @notice TWAP with explicit sufficiency check on stored samples.
     * @param market Market/collection address.
     * @param windowSeconds TWAP window.
     * @param minDataPoints Minimum distinct samples required for `isValid`.
     * @return twapPrice Computed TWAP value.
     * @return isValid False when the buffer has too few points for the requested window.
     */
    function getTWAPWithValidation(
        address market,
        uint256 windowSeconds,
        uint256 minDataPoints
    ) external view returns (uint256 twapPrice, bool isValid);

    /**
     * @notice ETH/USD reference from the configured Pyth feed.
     * @return price Normalized ETH price.
     */
    function getEthUsdPrice() external view returns (uint256 price);

    /**
     * @notice Count of healthy configured primary sources (0 or 1 in typical single-feed setup).
     */
    function getValidSourceCount(address market) external view returns (uint256);

    /**
     * @notice Append a TWAP sample from the current on-chain oracle snapshot (keeper/oracle role).
     * @param market Market/collection address.
     */
    function recordPricePoint(address market, uint256 price) external;

    /**
     * @notice Evaluate circuit breakers after optionally ingesting a price observation.
     * @param market Market/collection address.
     * @param currentPrice Price input used by price-drop style checks.
     * @param volume24h Reserved / auxiliary metric for volume breakers when enabled (may be ignored).
     * @return triggered True if any breaker fired in this call.
     */
    function checkBreakers(address market, uint256 currentPrice, uint256 volume24h) external returns (bool triggered);

    /**
     * @notice Force a breaker into triggered state (guardian).
     */
    function triggerBreaker(address market, DataTypes.BreakerType breakerType) external;

    /**
     * @notice Clear a triggered breaker when safe (admin or guardian per implementation).
     */
    function resetBreaker(address market, DataTypes.BreakerType breakerType) external;

    /**
     * @notice Automatically clear breakers that are eligible once oracle health returns.
     */
    function autoResetBreakers(address market) external;

    /**
     * @notice Whether a class of trading action is permitted under pause/breaker state.
     * @param market Market/collection address.
     * @param actionType Implementation-specific action bucket (e.g. open interest increases).
     */
    function isActionAllowed(address market, uint8 actionType) external view returns (bool);

    /**
     * @notice Breaker state struct for UI/risk.
     */
    function getBreakerStatus(
        address market,
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerStatus memory);

    /**
     * @notice Breaker configuration for `breakerType` on `market`.
     */
    function getBreakerConfig(
        address market,
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerConfig memory);

    /**
     * @notice Aggregate restriction: global pause or any active breaker.
     * @return isRestricted True if trading should treat the market as restricted.
     * @return activeBreakers Count of breakers currently in triggered state.
     */
    function isMarketRestricted(address market) external view returns (bool isRestricted, uint256 activeBreakers);

    /**
     * @notice Start guardian timelined emergency pause proposal over `targets`.
     * @param targets Contracts implementing pause to be enumerated in execution.
     * @param reason Optional string for **off-chain** records (indexers, incident tickets). Same ABI as a named `reason` argument; the current implementation does **not** read or emit it—only `targets` affect on-chain state.
     * @return pauseId Proposal identifier for confirmations.
     */
    function proposeEmergencyPause(
        address[] calldata targets,
        string calldata reason
    ) external returns (bytes32 pauseId);

    /**
     * @notice Second-step guardian confirmation that executes pause when quorum met.
     */
    function confirmEmergencyPause(bytes32 pauseId) external;

    /**
     * @notice Flip global pause flag without per-target enumeration (emergency kill-switch).
     */
    function activateGlobalPause() external;

    /**
     * @notice Clear global pause (admin).
     */
    function deactivateGlobalPause() external;

    /**
     * @notice Whether global pause flag is set.
     */
    function isGloballyPaused() external view returns (bool);

    /**
     * @notice Propose a time-bounded manual price override for emergencies.
     * @return proposalId Guardian multisig proposal identifier.
     */
    function proposeEmergencyPrice(
        address market,
        uint256 price,
        uint256 validUntil
    ) external returns (bytes32 proposalId);

    /**
     * @notice Confirm emergency price proposal; applies override when quorum satisfied.
     */
    function confirmEmergencyPrice(bytes32 proposalId) external;

    /**
     * @notice Bind a Pyth `feedId` and staleness/confidence bounds to `market`.
     */
    function setPythFeed(address market, bytes32 feedId, uint256 maxStaleness, uint64 maxConfidence) external;

    /**
     * @notice Configure numeric thresholds for a breaker type.
     */
    function configureBreaker(
        address market,
        DataTypes.BreakerType breakerType,
        uint256 threshold,
        uint256 windowSeconds,
        uint256 cooldownSeconds
    ) external;

    /**
     * @notice Enable/disable a breaker without changing its numeric config.
     */
    function setBreakerEnabled(address market, DataTypes.BreakerType breakerType, bool enabled) external;

    /**
     * @notice Register a contract address that emergency pause may target.
     */
    function registerPausable(address target) external;

    /**
     * @notice Number of distinct guardian signatures required for emergency pause execution.
     */
    function setGuardianQuorum(uint256 quorum) external;

    /**
     * @notice Number of confirmations required for emergency price proposals.
     */
    function setEmergencyPriceQuorum(uint256 quorum) external;

    /**
     * @notice Whitelist a market address for supported-market enumeration.
     */
    function addSupportedMarket(address market) external;

    /**
     * @notice Read Pyth feed id and safety bounds for `market`.
     * @return feedId Pyth price id.
     * @return maxStaleness Max allowed age of publish time.
     * @return minPrice Floor price when configured.
     * @return maxPrice Ceiling price when configured.
     */
    function getOracleConfig(
        address market
    ) external view returns (bytes32 feedId, uint256 maxStaleness, uint256 minPrice, uint256 maxPrice);

    /**
     * @notice Lightweight health probe suitable for keepers and UI badges.
     * @return healthy True if primary feed is readable and fresh enough.
     * @return reason Empty when healthy; otherwise short diagnostic string.
     */
    function isOracleHealthy(address market) external view returns (bool healthy, string memory reason);

    /**
     * @notice Approximate historical slot price (bucketed storage; coarse resolution).
     */
    function getHistoricalPrice(address market, uint256 hoursAgo) external view returns (uint256);

    /**
     * @notice Enumerate markets pushed via `addSupportedMarket`.
     */
    function getSupportedMarkets() external view returns (address[] memory);

    /**
     * @notice Addresses registered for emergency pause targeting.
     */
    function getPausableList() external view returns (address[] memory);

    /**
     * @notice Current guardian quorum for pause proposals.
     */
    function getGuardianQuorum() external view returns (uint256);
}
