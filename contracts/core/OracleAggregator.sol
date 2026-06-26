// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import "../base/AccessControlled.sol";
import "../libraries/DataTypes.sol";
import "../libraries/OracleAggregatorLib.sol";
import "../libraries/CircuitBreakerLib.sol";
import "../libraries/EmergencyPauseLib.sol";
import "../libraries/EmergencyPriceLib.sol";
import "../interfaces/IMarketCalendar.sol";
import "../interfaces/IOracleAggregator.sol";
import "../interfaces/IPriceSource.sol";

/**
 * @title OracleAggregator
 * @notice Pyth-backed prices per market address, TWAP ring buffer, circuit breakers, emergency pause/price governance, and trading gating hooks.
 * @dev Implements `IOracleAggregator`; parameter names use `collection` internally as the keyed market address.
 *
 * @dev OPTIONAL SECOND SOURCE (CROSS-CHECK):
 *      The aggregator still derives every market price from Pyth as the PRIMARY
 *      source. It can now ALSO be wired to one independent secondary source via
 *      `setSecondarySource` (e.g. a `RedStoneAdapter` covering crypto + RWA on
 *      Conflux eSpace). When a market opts in (`setCrossCheckEnabled`) and a
 *      non-zero `crossSourceMaxDeviationBps` is configured, `_getPriceView`
 *      refuses to serve a Pyth price that diverges from the secondary beyond the
 *      threshold (reverts `DeviationTooHigh`), and `getValidSourceCount` returns
 *      up to `2`. The secondary is consulted through the `IPriceSource` view and
 *      is wrapped in try/catch, so a faulty/stale secondary degrades cleanly to
 *      single source rather than bricking primary reads. The emergency manual
 *      price override still short-circuits ALL of this by design.
 *
 *      When NO secondary is wired (the default), behaviour is unchanged:
 *      `getValidSourceCount` returns at most `1` and `DataTypes.MIN_ORACLE_SOURCES`
 *      is `1`. The compensating controls below remain the primary defenses:
 *        • A Pyth fault or mispublication for a market is a single point of
 *          failure for entry price, liquidation, PnL and vault NAV.
 *        • Residual risk is bounded by: per-feed `maxConfidence` and staleness
 *          gates (`_getPriceView`), the TWAP-vs-spot deviation guards on
 *          open/close/liquidate, the price-drop / TWAP-deviation circuit
 *          breakers, and the guardian manual-price override (quorum + 24h
 *          delay) plus global pause.
 *        • Liquidations additionally refuse to run against an active manual
 *          price override (see `TradingCore._liquidate`).
 *
 *      OPERATIONAL GUIDANCE: before raising per-market exposure caps or
 *      enabling high leverage, operators should consider adding a second
 *      independent feed and a cross-source deviation check. The interface and
 *      `getValidSourceCount` are already shaped to report a source count, so a
 *      future multi-source upgrade can raise `MIN_ORACLE_SOURCES` without an
 *      external API change.
 */
contract OracleAggregator is
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    AccessControlled,
    IOracleAggregator
{
    error StalePrice();
    error InsufficientConfidence();
    error PriceOutOfBounds();
    error InvalidSource();
    error DataNotFound();
    error DeviationTooHigh();
    error AdapterNotFound();
    error TimelockNotExpired();
    error NoEthUsdFeed();
    error TWAPUpdateTooFrequent();
    error ReportedPriceMustBeZero();
    error SequencerDown();
    error SequencerGracePeriodNotOver();
    error BreakerNotConfigured();
    error BreakerAlreadyTriggered();
    error BreakerNotTriggered();
    error CooldownActive();
    error InsufficientConfirmations();
    error AlreadyConfirmed();
    error ProposalNotFound();
    error ProposalExpired();
    error GlobalPauseActive();
    error NotRegistered();
    error InvalidWindowSeconds();
    error InvalidCooldownSeconds();
    error InsufficientTWAPData();
    error EmergencyPriceDeviationTooHigh();
    error EmergencyPriceProposalNotFound();
    error EmergencyPriceAlreadyConfirmed();
    error EmergencyPriceProposalExpired();
    error NotOracleOrKeeper();
    error AlreadyInitialized();
    error InsufficientUpdateFee();
    error PythUpdateFailed();
    /// @dev Caps for `marketId` strings.
    error MarketIdTooLong();
    /// @dev `setPythFeed` must require a non-zero `maxConfidence` so
    ///      the silent 0.5%-of-price default cannot DoS price reads under
    ///      volatility.
    error MaxConfidenceRequired();
    /// @dev Cap on the registered pausable list.
    error TooManyPausables();
    /// @dev Feed-rotation timelock surface.
    error PendingFeedMismatch();
    error FeedTimelockActive();

    modifier onlyOracleOrKeeper() {
        if (!hasRole(ORACLE_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender)) revert NotOracleOrKeeper();
        _;
    }

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant TWAP_BUFFER_SIZE = 48;
    uint256 private constant PROPOSAL_EXPIRY = 1 hours;
    uint256 private constant MAX_WINDOW_HOURS = 24;
    uint256 private constant PAUSE_GAS_LIMIT = 100000;
    uint256 private constant MIN_TWAP_UPDATE_INTERVAL = 30;
    uint256 public constant PRICE_OVERRIDE_DELAY = 24 hours;
    /// @dev Timelock for rotating an already-configured market's Pyth feed to a
    ///      different feed id. Mitigates a single operator key repointing a live
    ///      market's price source to an attacker-favorable feed.
    uint256 public constant FEED_ROTATION_TIMELOCK = 24 hours;
    uint256 private constant MIN_TWAP_DATA_POINTS = 6;
    uint256 private constant EMERGENCY_PRICE_QUORUM = 2;
    uint256 private constant DEFAULT_TWAP_WINDOW = 15 minutes;
    uint256 private constant MAX_EMERGENCY_PRICE_DEVIATION_BPS = 3000;
    /// @dev Cap calendar `marketId` length to 32 bytes so storage
    ///      writes and the per-call `bytes(...).length` reads stay O(1).
    uint256 private constant MAX_MARKET_ID_BYTES = 32;
    /// @dev Cap the number of pausable targets enumerable in the
    ///      emergency-pause flow so iteration costs stay bounded.
    uint256 private constant MAX_PAUSABLES = 50;
    /// @dev When the global pause is activated by a single guardian
    ///      via `activateGlobalPause`, it auto-expires after this duration unless
    ///      explicitly re-armed. Quorum-driven pauses (via the proposal flow) are
    ///      not subject to this expiry.
    uint256 public constant GLOBAL_PAUSE_AUTO_EXPIRY = 6 hours;
    /// @dev Tightened default confidence band kept for backward compat
    ///      but `setPythFeed` now requires `maxConfidence > 0`.
    uint256 private constant DEFAULT_CONFIDENCE_DENOMINATOR = 200; // = 0.5% of price
    /// @dev CLOSED-MARKET STALENESS: when the market calendar
    ///      reports a session closed (weekends/holidays for RWA markets), the
    ///      staleness gate in `_getPriceView` widens to this value so the last
    ///      in-session price remains readable for view/accounting reads across
    ///      the break. This does NOT loosen any value-moving path: opens and
    ///      closes require an OPEN session (`_checkMarketOpen`), and liquidation
    ///      during a closed session is gated separately
    ///      (`TradingCore.closedSessionLiquidationEnabled`, which additionally
    ///      blocks on an active manual-price override and enforces the
    ///      TWAP-deviation guard). Named here (rather than inlined) so the
    ///      assumption is explicit and auditable.
    uint256 private constant CLOSED_MARKET_MAX_STALENESS = 4 days;

    struct OracleConfig {
        bytes32 feedId;
        uint256 maxStaleness;
        uint256 minPrice;
        uint256 maxPrice;
        bool allowSingleSource;
        uint64 maxConfidence;
    }

    struct GeneratedPrice {
        uint256 price;
        uint256 confidence;
        uint256 timestamp;
    }

    struct TWAPBuffer {
        DataTypes.PricePoint[48] points;
        uint256 head;
        uint256 count;
    }

    mapping(address => OracleConfig) private _configs;
    mapping(address => GeneratedPrice) private _prices;
    mapping(address => TWAPBuffer) private _twapBuffers;

    address[] private _supportedAssets;

    IPyth public pyth;

    mapping(address => uint256) private _manualPrices;
    mapping(address => uint256) private _manualPriceExpiry;
    mapping(address => EmergencyPriceLib.PendingPriceOverride) private _pendingManualPrices;

    /// @dev NOTE: sequencer-uptime defenses are scaffolded but not wired
    ///      to a live feed. Conflux eSpace does not have a Chainlink L2
    ///      sequencer feed; the storage and setters are kept for future
    ///      compatibility with L2 deployments. The fields below MUST NOT
    ///      be removed without a planned upgrade that also rebalances the
    ///      `__gap` array.
    uint256 public sequencerGracePeriod;
    uint256 public defaultMaxStaleness;
    uint256 public defaultMaxDeviationBps;
    address public sequencerUptimeFeed;
    bool public sequencerCheckEnabled;
    uint256 public maxEthStaleness;
    uint256 public emergencyPriceQuorum;
    bytes32 public ethFeedId;

    mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) private _breakerConfigs;
    mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) private _breakerStatuses;
    mapping(address => mapping(uint256 => uint256)) private _historicalPrices;
    mapping(address => uint256) private _lastPriceTime;

    bool private _globalPause;
    uint256 public guardianQuorum;
    mapping(bytes32 => EmergencyPauseLib.PauseProposal) private _pauseProposals;
    mapping(address => bool) private _pausables;
    address[] private _pausableList;
    mapping(address => bool) public failedPauses;
    address[] private _failedPauseList;
    uint256 public failedPauseCount;

    mapping(bytes32 => EmergencyPriceLib.EmergencyPriceProposal) private _emergencyPriceProposals;
    uint256 private _emergencyPriceProposalNonce;

    /// @dev Per-guardian per-market last proposal timestamp; rate-limits
    ///      `proposeEmergencyPrice` so a single guardian cannot keep an
    ///      override pinned by refreshing it indefinitely.
    mapping(address => mapping(address => uint256)) private _lastEmergencyPriceProposalAt;
    /// @dev Minimum seconds between proposals from the same guardian for
    ///      the same collection. Default 1 hour; admin-tunable.
    uint256 public emergencyPriceProposalMinInterval;

    IMarketCalendar public marketCalendar;
    mapping(address => string) public marketIds;

    /// @dev Activation timestamp of `_globalPause` when raised via the
    ///      single-guardian fast path (`activateGlobalPause`). Permits permissionless
    ///      auto-expiry after `GLOBAL_PAUSE_AUTO_EXPIRY` to avoid indefinite halts.
    uint256 public globalPauseActivatedAt;

    /// @dev Staged feed-rotation proposals. Repointing an already-configured
    ///      market to a DIFFERENT Pyth feed is the single highest-impact
    ///      operator action (it can swap the price source under live
    ///      positions), so it is gated behind a 24h timelock. First-time feed
    ///      configuration and same-feed parameter tweaks remain immediate.
    struct PendingFeed {
        bytes32 feedId;
        uint256 maxStaleness;
        uint64 maxConfidence;
        uint256 effective;
    }
    mapping(address => PendingFeed) private _pendingFeeds;

    /// @dev Optional INDEPENDENT second price source (e.g. `RedStoneAdapter`)
    ///      used purely for a cross-source deviation guard. Pyth stays primary;
    ///      this is consulted only when set AND per-market `crossCheckEnabled` is
    ///      true. A faulty secondary can never brick a primary read — reads of it
    ///      are wrapped in try/catch and a failure degrades to single source.
    IPriceSource public secondarySource;
    /// @dev Max allowed deviation (bps) between the primary (Pyth) price and the
    ///      secondary price before a price read reverts with `DeviationTooHigh`.
    ///      0 disables the deviation guard even when a secondary is configured.
    uint256 public crossSourceMaxDeviationBps;
    /// @dev Per-market opt-in for the cross-source deviation guard. Defaults to
    ///      false so existing markets behave exactly as before until enabled.
    mapping(address => bool) public crossCheckEnabled;

    // gap reduced by 1 slot for `_pendingFeeds` (a mapping occupies one slot;
    // the PendingFeed struct lives in the mapping's value slots, not inline)
    // and by a further 3 slots for `secondarySource`, `crossSourceMaxDeviationBps`
    // and the `crossCheckEnabled` mapping (17 -> 14).
    uint256[14] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize oracle, access control, and default staleness/quorum parameters.
    function initialize(address admin, address _pyth) external initializer {
        if (address(pyth) != address(0)) revert AlreadyInitialized();
        __ReentrancyGuard_init();
        __AccessControlled_init(admin);
        __UUPSUpgradeable_init();

        pyth = IPyth(_pyth);
        defaultMaxStaleness = 15 minutes;

        maxEthStaleness = 1 hours;
        // Tightened defaults: see `setGuardianQuorum` / `setEmergencyPriceQuorum`.
        emergencyPriceQuorum = 3;
        sequencerGracePeriod = 30 minutes;
        guardianQuorum = 3;
        // Default 1h between proposals from the same guardian for the
        // same market (rate-limit on emergency-price spam).
        emergencyPriceProposalMinInterval = 1 hours;
    }

    /// @custom:oz-upgrades From `UUPSUpgradeable`: only admin may authorize implementation upgrades.
    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {
        _enforceUpgradeTimelock(newImplementation);
    }

    function _getPriceView(
        address collection
    ) internal view returns (uint256 price, uint256 confidence, uint256 timestamp) {
        // MANUAL EMERGENCY-PRICE OVERRIDE: a live override
        // short-circuits the Pyth read and returns a guardian-set price with a
        // synthetic full-confidence band. This is a high-trust lever, so it is
        // fenced by: a multi-guardian quorum + `PRICE_OVERRIDE_DELAY` (24h)
        // before activation, a `MAX_EMERGENCY_PRICE_DEVIATION_BPS` cap vs the
        // reference price at proposal time, a per-guardian proposal rate-limit,
        // an expiry (`_manualPriceExpiry`), exclusion from the TWAP buffer
        // (`recordPricePoint` skips while active), and a hard lockout of
        // liquidations while active (`TradingCore._liquidate`). It is intended
        // only for feed-outage / de-peg situations and never to drive routine
        // liquidation outcomes.
        if (_manualPrices[collection] > 0 && block.timestamp <= _manualPriceExpiry[collection]) {
            OracleConfig memory manualConfig = _configs[collection];
            uint256 manualPrice = _manualPrices[collection];
            if (manualConfig.minPrice > 0 && manualPrice < manualConfig.minPrice) revert PriceOutOfBounds();
            if (manualConfig.maxPrice > 0 && manualPrice > manualConfig.maxPrice) revert PriceOutOfBounds();
            return (manualPrice, PRECISION, block.timestamp);
        }

        OracleConfig memory config = _configs[collection];
        if (config.feedId == bytes32(0)) revert InvalidSource();

        // We read via `getPriceUnsafe` and enforce staleness manually below
        // rather than using Pyth's `getPriceNoOlderThan`. This is
        // intentional: staleness is per-market (`config.maxStaleness`) and is
        // deliberately widened to `CLOSED_MARKET_MAX_STALENESS` during closed
        // RWA sessions — semantics `getPriceNoOlderThan` cannot express. The
        // explicit `block.timestamp > publishTime + maxStale` check below is the
        // single staleness gate for every read.
        try pyth.getPriceUnsafe(config.feedId) returns (PythStructs.Price memory pythPrice) {
            uint256 maxStale = config.maxStaleness > 0 ? config.maxStaleness : defaultMaxStaleness;

            if (address(marketCalendar) != address(0)) {
                string memory mId = marketIds[collection];
                if (bytes(mId).length > 0 && !marketCalendar.isMarketOpen(mId)) {
                    maxStale = CLOSED_MARKET_MAX_STALENESS;
                }
            }

            if (block.timestamp > pythPrice.publishTime + maxStale) revert StalePrice();
            if (pythPrice.price <= 0) revert InvalidSource();

            uint256 normalizedPrice = _normalizePythPrice(pythPrice.price, pythPrice.expo);
            // Tiny Pyth prices can normalize to 0 even though the raw
            // signed value is positive; without this guard the buffer and
            // downstream consumers see a zero price as a valid sample.
            if (normalizedPrice == 0) revert InvalidSource();
            // `pythPrice.conf` is uint64; an `int64(uint64(...))` cast can
            // overflow to a negative value for adversarially large
            // confidences and silently zero out the normalized confidence,
            // bypassing the uncertainty check. Compute confidence directly
            // in unsigned arithmetic.
            uint256 normalizedConf = _normalizePythConfidence(uint256(pythPrice.conf), pythPrice.expo);

            if (config.maxConfidence > 0) {
                if (normalizedConf > config.maxConfidence) revert InsufficientConfidence();
            } else {
                // tightened default from 2% to 0.5% confidence band when operators have
                // not configured a feed-specific cap.
                if (normalizedConf > normalizedPrice / 200) revert InsufficientConfidence();
            }

            if (config.minPrice > 0 && normalizedPrice < config.minPrice) revert PriceOutOfBounds();
            if (config.maxPrice > 0 && normalizedPrice > config.maxPrice) revert PriceOutOfBounds();

            // CROSS-SOURCE GUARD: when an independent secondary source is wired
            // and enabled for this market, refuse to serve a primary price that
            // diverges from the secondary beyond `crossSourceMaxDeviationBps`.
            _crossCheckDeviation(collection, normalizedPrice);

            return (normalizedPrice, normalizedConf, pythPrice.publishTime);
        } catch {
            revert DataNotFound();
        }
    }

    /// @dev Reverts with `DeviationTooHigh` when the secondary source disagrees
    ///      with the primary (Pyth) price by more than `crossSourceMaxDeviationBps`.
    ///      No-ops (degrading to single source) when: no secondary is set, the
    ///      market has not opted in, the guard is disabled (bps == 0), the
    ///      secondary read reverts, or the secondary has no valid/fresh price.
    ///      Deviation is measured against the SMALLER of the two prices, the
    ///      conservative choice that maximizes the computed divergence.
    function _crossCheckDeviation(address collection, uint256 primaryPrice) internal view {
        IPriceSource src = secondarySource;
        if (address(src) == address(0) || !crossCheckEnabled[collection]) return;
        uint256 maxDev = crossSourceMaxDeviationBps;
        if (maxDev == 0 || primaryPrice == 0) return;
        // A codeless secondary (EOA / self-destructed) would make the high-level
        // call revert via the compiler's extcodesize guard BEFORE try/catch can
        // catch it. Skip it so a misconfigured source degrades to single source.
        if (address(src).code.length == 0) return;

        try src.getPrice(collection) returns (uint256 secPrice, uint256, uint256, bool valid) {
            if (!valid || secPrice == 0) return;
            uint256 diff = primaryPrice > secPrice ? primaryPrice - secPrice : secPrice - primaryPrice;
            uint256 ref = primaryPrice < secPrice ? primaryPrice : secPrice;
            if (diff * BPS > ref * maxDev) revert DeviationTooHigh();
        } catch {
            // A misbehaving secondary must never brick the primary read.
            return;
        }
    }

    /// @inheritdoc IOracleAggregator
    function getPrice(address collection) public view returns (uint256 price, uint256 confidence, uint256 timestamp) {
        return _getPriceView(collection);
    }

    /// @inheritdoc IOracleAggregator
    function getPriceWithConfidence(address collection, uint256 maxUncertainty) external view returns (uint256 price) {
        uint256 confidence;
        (price, confidence, ) = _getPriceView(collection);
        // `maxUncertainty` is a FRACTION of price scaled to 1e18 (e.g. 8e17 = 80%),
        // while `confidence` is an ABSOLUTE band normalized to 1e18 price units.
        // Comparing them directly would (for any asset priced above ~$1) make the
        // absolute band dwarf the fractional cap and revert every read. Convert
        // the confidence to the same fractional domain before comparing.
        if (price == 0) revert InsufficientConfidence();
        uint256 confidenceFraction = (confidence * PRECISION) / price;
        if (confidenceFraction > maxUncertainty) revert InsufficientConfidence();
    }

    /// @inheritdoc IOracleAggregator
    function getTWAP(address collection, uint256 windowSeconds) public view returns (uint256 twapPrice) {
        TWAPBuffer storage buffer = _twapBuffers[collection];
        if (buffer.count == 0) {
            (twapPrice, , ) = _getPriceView(collection);
            return twapPrice;
        }
        return
            OracleAggregatorLib.calculateTWAP(buffer.points, buffer.head, buffer.count, windowSeconds, block.timestamp);
    }

    /// @inheritdoc IOracleAggregator
    /// @dev WEIGHTING SEMANTICS: this getter intentionally uses a DIFFERENT
    ///      averaging scheme from `getTWAP`. `getTWAP` is TIME-weighted (recent
    ///      samples weigh more; see `OracleAggregatorLib.calculateTWAP`). This
    ///      validated variant is CONFIDENCE-weighted (inverse-variance: lower
    ///      Pyth uncertainty weighs more; see
    ///      `OracleAggregatorLib.calculateTWAPWithCount`) and additionally
    ///      reports whether at least `minDataPoints` samples fell inside the
    ///      window. This is the reference consumed by the open / close /
    ///      liquidate deviation guards: confidence weighting de-emphasises
    ///      high-uncertainty ticks (which are exactly the ones an attacker would
    ///      try to inject), while the `isValid` flag lets callers refuse to act
    ///      against a cold/thin buffer. The two getters are deliberately not
    ///      interchangeable; callers must pick the one matching their intent.
    function getTWAPWithValidation(
        address collection,
        uint256 windowSeconds,
        uint256 minDataPoints
    ) public view returns (uint256 twapPrice, bool isValid) {
        TWAPBuffer storage buffer = _twapBuffers[collection];
        if (buffer.count == 0) {
            (twapPrice, , ) = _getPriceView(collection);
            return (twapPrice, false);
        }
        uint256 dataPointCount;
        (twapPrice, dataPointCount) = OracleAggregatorLib.calculateTWAPWithCount(
            buffer.points,
            buffer.head,
            buffer.count,
            windowSeconds,
            block.timestamp
        );
        isValid = dataPointCount >= minDataPoints;
    }

    /// @inheritdoc IOracleAggregator
    function getEthUsdPrice() external view returns (uint256 price) {
        if (ethFeedId == bytes32(0)) revert NoEthUsdFeed();

        try pyth.getPriceUnsafe(ethFeedId) returns (PythStructs.Price memory pythPrice) {
            if (block.timestamp > pythPrice.publishTime + maxEthStaleness) revert StalePrice();
            if (pythPrice.price <= 0) revert InvalidSource();

            return _normalizePythPrice(pythPrice.price, pythPrice.expo);
        } catch {
            revert DataNotFound();
        }
    }

    /// @notice Configure the Pyth feed id used for ETH/USD conversions.
    function setEthFeedId(bytes32 _feedId) external onlyOperator {
        ethFeedId = _feedId;
    }

    /// @notice configurable default staleness (max 1 day).
    function setDefaultMaxStaleness(uint256 staleness) external onlyAdmin {
        if (staleness == 0 || staleness > 1 days) revert StalePrice();
        defaultMaxStaleness = staleness;
    }

    /// @notice configurable ETH/USD feed staleness cap (max 6 hours).
    function setMaxEthStaleness(uint256 staleness) external onlyAdmin {
        if (staleness == 0 || staleness > 6 hours) revert StalePrice();
        maxEthStaleness = staleness;
    }

    /// @notice configurable sequencer grace period (max 2 hours).
    function setSequencerGracePeriod(uint256 gracePeriod) external onlyAdmin {
        if (gracePeriod > 2 hours) revert SequencerGracePeriodNotOver();
        sequencerGracePeriod = gracePeriod;
    }

    /// @inheritdoc IOracleAggregator
    /// @dev Multi-source aware: counts the primary Pyth feed (when healthy) plus,
    ///      when a secondary source is wired and enabled for the market, the
    ///      secondary when it reports a valid/fresh price. Returns 0, 1 or 2.
    function getValidSourceCount(address collection) external view returns (uint256 count) {
        if (_configs[collection].feedId == bytes32(0)) return 0;
        (bool healthy, ) = isOracleHealthy(collection);
        if (healthy) count = 1;

        IPriceSource src = secondarySource;
        if (address(src) != address(0) && crossCheckEnabled[collection] && address(src).code.length > 0) {
            try src.getPrice(collection) returns (uint256 secPrice, uint256, uint256, bool valid) {
                if (valid && secPrice > 0) {
                    unchecked {
                        ++count;
                    }
                }
            } catch {
                // ignore a faulty secondary in the health count
            }
        }
    }

    /* ===================== SECONDARY SOURCE (CROSS-CHECK) ===================== */

    event SecondarySourceUpdated(address indexed source);
    event CrossSourceMaxDeviationUpdated(uint256 bps);
    event CrossCheckConfigured(address indexed market, bool enabled);

    /// @notice Wire (or clear, with `address(0)`) the independent secondary price
    ///         source used for cross-source deviation checks. Pyth stays primary.
    /// @dev The secondary is only consulted for markets with `crossCheckEnabled`
    ///      set and while `crossSourceMaxDeviationBps > 0`.
    function setSecondarySource(address source) external onlyAdmin {
        secondarySource = IPriceSource(source);
        emit SecondarySourceUpdated(source);
    }

    /// @notice Set the max primary-vs-secondary deviation (bps) tolerated before a
    ///         price read reverts. 0 disables the guard. Capped at 50% (5000 bps).
    function setCrossSourceMaxDeviationBps(uint256 bps) external onlyAdmin {
        if (bps > 5000) revert DeviationTooHigh();
        crossSourceMaxDeviationBps = bps;
        emit CrossSourceMaxDeviationUpdated(bps);
    }

    /// @notice Opt a market in/out of the cross-source deviation guard.
    function setCrossCheckEnabled(address collection, bool enabled) external onlyOperator {
        crossCheckEnabled[collection] = enabled;
        emit CrossCheckConfigured(collection, enabled);
    }

    /// @notice Push fresh Pyth price updates and pay the network fee. Required prior to executing keeper-driven orders so prices are up-to-date in the same transaction.
    /// @param priceUpdateData Pyth signed price-feed payloads as supplied by Hermes/keeper.
    /// @return feeRefund Any unused ETH refunded to `msg.sender` (caller forwards `msg.value` >= update fee).
    /// @dev Anyone may call (price updates are signed by Pyth and are not trust-sensitive); revert on insufficient fee.
    function updatePrices(bytes[] calldata priceUpdateData) external payable returns (uint256 feeRefund) {
        if (priceUpdateData.length == 0) {
            if (msg.value > 0) {
                (bool ok, ) = msg.sender.call{value: msg.value}("");
                if (!ok) revert PythUpdateFailed();
            }
            return msg.value;
        }
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        if (msg.value < fee) revert InsufficientUpdateFee();
        try pyth.updatePriceFeeds{value: fee}(priceUpdateData) {} catch {
            revert PythUpdateFailed();
        }
        feeRefund = msg.value - fee;
        if (feeRefund > 0) {
            (bool ok, ) = msg.sender.call{value: feeRefund}("");
            if (!ok) revert PythUpdateFailed();
        }
    }

    /// @inheritdoc IOracleAggregator
    function recordPricePoint(address collection, uint256 reportedPrice) external onlyOracleOrKeeper {
        if (reportedPrice != 0) revert ReportedPriceMustBeZero();
        _seedTwapFromOracle(collection);
    }

    /// @notice Permissionless TWAP-buffer seeding (liveness backstop).
    /// @dev Same effect as `recordPricePoint` but callable by anyone, so the
    ///      open / close / liquidate TWAP-deviation gates and the open-side
    ///      TWAP-validity requirement cannot stall purely because the
    ///      keeper / oracle role-set is offline or censoring. This is NOT
    ///      trust-sensitive: the caller supplies no price; the observation is
    ///      taken from the trusted Pyth snapshot via `_getPriceView` (which
    ///      enforces staleness / confidence / bounds), the 30s
    ///      `MIN_TWAP_UPDATE_INTERVAL` spacing guard still applies, and an
    ///      active manual override still pauses sampling. The worst a caller
    ///      can do is pay gas to record the real current price.
    function pokeTWAP(address collection) external {
        _seedTwapFromOracle(collection);
    }

    /// @dev Shared TWAP ring-buffer seeding from the current trusted oracle
    ///      snapshot. No-ops while a manual override is active or within the
    ///      minimum sampling interval.
    function _seedTwapFromOracle(address collection) internal {
        // Refuse to seed the TWAP buffer while a manual price override is
        // live. Otherwise the override price would propagate into TWAP and
        // erode every TWAP-vs-spot deviation defense (open / close /
        // liquidate). The buffer pauses cleanly: when the override expires,
        // future calls resume sampling Pyth.
        if (_manualPrices[collection] > 0 && block.timestamp <= _manualPriceExpiry[collection]) {
            return;
        }

        (uint256 currentPrice, uint256 conf, ) = _getPriceView(collection);

        TWAPBuffer storage buffer = _twapBuffers[collection];

        if (buffer.count > 0) {
            uint256 lastIndex = buffer.head == 0 ? TWAP_BUFFER_SIZE - 1 : buffer.head - 1;
            if (block.timestamp < buffer.points[lastIndex].timestamp + MIN_TWAP_UPDATE_INTERVAL) {
                return;
            }
        }

        buffer.points[buffer.head] = DataTypes.PricePoint({
            price: uint128(currentPrice),
            timestamp: uint64(block.timestamp),
            confidence: uint64(conf)
        });

        buffer.head = (buffer.head + 1) % TWAP_BUFFER_SIZE;
        if (buffer.count < TWAP_BUFFER_SIZE) {
            unchecked {
                ++buffer.count;
            }
        }

        emit TWAPUpdated(collection, getTWAP(collection, DEFAULT_TWAP_WINDOW), DEFAULT_TWAP_WINDOW);
    }

    /// @inheritdoc IOracleAggregator
    /// @dev Restricted to keepers/oracles to prevent griefing. The supplied `currentPrice` is ignored;
    /// the value is derived internally from the trusted oracle snapshot.
    function checkBreakers(
        address collection,
        uint256 /* currentPrice */,
        uint256 /* volume24h */
    ) external onlyOracleOrKeeper nonReentrant returns (bool triggered) {
        (uint256 currentPrice, , ) = _getPriceView(collection);
        _recordPrice(collection, currentPrice);
        DataTypes.BreakerConfig memory priceDropConfig = _breakerConfigs[collection][DataTypes.BreakerType.PRICE_DROP];
        uint256 priceDropRef = priceDropConfig.windowSeconds > 0
            ? getTWAP(collection, priceDropConfig.windowSeconds)
            : getTWAP(collection, DEFAULT_TWAP_WINDOW);
        if (
            CircuitBreakerLib.checkPriceDropBreaker(
                collection,
                currentPrice,
                priceDropRef,
                _breakerConfigs,
                _breakerStatuses
            )
        ) {
            triggered = true;
            emit CircuitBreakerAlert(
                collection,
                DataTypes.BreakerType.PRICE_DROP,
                priceDropConfig.threshold,
                currentPrice
            );
        }
        DataTypes.BreakerConfig memory twapConfig = _breakerConfigs[collection][DataTypes.BreakerType.TWAP_DEVIATION];
        if (twapConfig.enabled) {
            uint256 twap = getTWAP(collection, twapConfig.windowSeconds);
            if (
                CircuitBreakerLib.checkTWAPDeviationBreaker(
                    collection,
                    currentPrice,
                    twap,
                    _breakerConfigs,
                    _breakerStatuses
                )
            ) {
                triggered = true;
                emit CircuitBreakerAlert(
                    collection,
                    DataTypes.BreakerType.TWAP_DEVIATION,
                    twapConfig.threshold,
                    currentPrice
                );
            }
        }
    }

    /// @inheritdoc IOracleAggregator
    function triggerBreaker(address collection, DataTypes.BreakerType breakerType) external onlyGuardian {
        CircuitBreakerLib.triggerBreaker(collection, breakerType, _breakerConfigs, _breakerStatuses);
    }

    /// @inheritdoc IOracleAggregator
    function resetBreaker(address collection, DataTypes.BreakerType breakerType) external onlyAdminOrGuardian {
        CircuitBreakerLib.resetBreaker(collection, breakerType, hasRole(ADMIN_ROLE, msg.sender), _breakerStatuses);
    }

    /// @inheritdoc IOracleAggregator
    function autoResetBreakers(address collection) external whenNotPaused {
        (bool healthy, ) = isOracleHealthy(collection);
        if (!healthy) return;
        CircuitBreakerLib.autoResetBreakers(collection, _breakerStatuses);
    }

    /// @inheritdoc IOracleAggregator
    function isOracleHealthy(address collection) public view returns (bool healthy, string memory reason) {
        OracleConfig memory config = _configs[collection];
        if (config.feedId == bytes32(0)) return (false, "Not configured");

        try pyth.getPriceUnsafe(config.feedId) returns (PythStructs.Price memory pythPrice) {
            uint256 maxStale = config.maxStaleness > 0 ? config.maxStaleness : defaultMaxStaleness;
            if (block.timestamp > pythPrice.publishTime + maxStale) return (false, "Stale price");
            if (pythPrice.price <= 0) return (false, "Invalid price");
            return (true, "");
        } catch {
            return (false, "Pyth revert");
        }
    }

    /// @inheritdoc IOracleAggregator
    function isActionAllowed(address collection, uint8 actionType) external view returns (bool) {
        // Use the expiry-aware view of global pause.
        return CircuitBreakerLib.isActionAllowed(collection, actionType, _isGloballyPausedView(), _breakerStatuses);
    }

    /// @inheritdoc IOracleAggregator
    /// @dev Second argument matches interface `reason` but is unnamed here to avoid an unused-parameter warning; it is not passed into `EmergencyPauseLib` (see interface @param reason).
    function proposeEmergencyPause(
        address[] calldata targets,
        string calldata /* reason */
    ) external onlyGuardian returns (bytes32 pauseId) {
        return EmergencyPauseLib.proposeEmergencyPause(targets, _pauseProposals);
    }

    /// @inheritdoc IOracleAggregator
    function confirmEmergencyPause(bytes32 pauseId) external onlyGuardian {
        EmergencyPauseLib.confirmEmergencyPause(
            pauseId,
            guardianQuorum,
            _pauseProposals,
            _pausables,
            failedPauses,
            _failedPauseList
        );
        failedPauseCount = _failedPauseList.length;
    }

    /// @inheritdoc IOracleAggregator
    function activateGlobalPause() external onlyGuardian {
        // Always (re-)stamp the activation timestamp. The previous
        // implementation made re-activation a no-op when already paused,
        // so a guardian who wanted to extend the auto-expiry window had
        // no way to do so without first calling `deactivateGlobalPause`
        // (admin-only) and re-activating. Re-stamping lets a guardian
        // hold the pause indefinitely while quorum forms.
        _globalPause = true;
        globalPauseActivatedAt = block.timestamp;
        emit GlobalPauseActivated(msg.sender);
    }

    /// @inheritdoc IOracleAggregator
    function deactivateGlobalPause() external onlyAdmin {
        if (_globalPause) {
            _globalPause = false;
            globalPauseActivatedAt = 0;
            emit GlobalPauseDeactivated(msg.sender);
        }
    }

    /// @notice Permissionless auto-expiry of a single-guardian global pause.
    /// @dev Anyone can call this after `GLOBAL_PAUSE_AUTO_EXPIRY` has
    ///      elapsed since `activateGlobalPause`. If a guardian wants the pause to
    ///      persist beyond the auto-expiry window, they must re-call
    ///      `activateGlobalPause` (which re-stamps the timer) before expiry, OR
    ///      route through the `proposeEmergencyPause` quorum flow which does not
    ///      auto-expire.
    function expireGlobalPause() external {
        if (!_globalPause) return;
        if (globalPauseActivatedAt == 0) return; // Quorum-driven pause: no expiry.
        if (block.timestamp < globalPauseActivatedAt + GLOBAL_PAUSE_AUTO_EXPIRY) {
            return;
        }
        _globalPause = false;
        globalPauseActivatedAt = 0;
        emit GlobalPauseAutoExpired(block.timestamp);
    }

    /// @notice Clear the failed-pause-target list once the underlying issue has been resolved .
    function clearFailedPauseTarget(address target) external onlyAdmin {
        if (!failedPauses[target]) return;
        failedPauses[target] = false;
        uint256 len = _failedPauseList.length;
        for (uint256 i = 0; i < len; ) {
            if (_failedPauseList[i] == target) {
                _failedPauseList[i] = _failedPauseList[len - 1];
                _failedPauseList.pop();
                break;
            }
            unchecked {
                ++i;
            }
        }
        failedPauseCount = _failedPauseList.length;
    }

    /// @inheritdoc IOracleAggregator
    function isGloballyPaused() external view returns (bool) {
        return _isGloballyPausedView();
    }

    /// @dev View-side helper that treats an expired single-guardian pause as
    ///      already-cleared, even if `expireGlobalPause` has not been called yet.
    function _isGloballyPausedView() internal view returns (bool) {
        if (!_globalPause) return false;
        if (globalPauseActivatedAt == 0) return true; // quorum pause, no expiry
        if (block.timestamp >= globalPauseActivatedAt + GLOBAL_PAUSE_AUTO_EXPIRY) return false;
        return true;
    }

    /// @inheritdoc IOracleAggregator
    function setPythFeed(
        address collection,
        bytes32 feedId,
        uint256 maxStaleness,
        uint64 maxConfidence
    ) external onlyOperator {
        // Refuse to register a feed without an explicit confidence cap.
        // The legacy 0.5%-of-price default reverted reads under any normal volatility
        // event; operators must consciously choose a per-feed cap matching the
        // expected confidence band (e.g. ~1-2% for equities, ~0.5-1% for crypto).
        if (maxConfidence == 0) revert MaxConfidenceRequired();

        bytes32 existing = _configs[collection].feedId;
        // Repointing an ALREADY-configured market to a DIFFERENT feed id is the
        // highest-impact operator action (swaps the price source under live
        // positions). Require a 24h staged proposal via `proposePythFeed`.
        // First-time configuration (existing == 0) and same-feed parameter
        // tweaks (staleness / confidence) remain immediate.
        if (existing != bytes32(0) && existing != feedId) {
            PendingFeed memory p = _pendingFeeds[collection];
            if (
                p.effective == 0 ||
                p.feedId != feedId ||
                p.maxStaleness != maxStaleness ||
                p.maxConfidence != maxConfidence
            ) {
                revert PendingFeedMismatch();
            }
            if (block.timestamp < p.effective) revert FeedTimelockActive();
            delete _pendingFeeds[collection];
        }

        _configs[collection].feedId = feedId;
        _configs[collection].maxStaleness = maxStaleness;
        _configs[collection].maxConfidence = maxConfidence;
        emit PythFeedSet(collection, feedId);
    }

    /// @notice Stage a feed rotation for an already-configured market. Effective
    ///         `FEED_ROTATION_TIMELOCK` (24h) later via `setPythFeed` with the
    ///         exact same arguments.
    function proposePythFeed(
        address collection,
        bytes32 feedId,
        uint256 maxStaleness,
        uint64 maxConfidence
    ) external onlyOperator {
        if (maxConfidence == 0) revert MaxConfidenceRequired();
        _pendingFeeds[collection] = PendingFeed({
            feedId: feedId,
            maxStaleness: maxStaleness,
            maxConfidence: maxConfidence,
            effective: block.timestamp + FEED_ROTATION_TIMELOCK
        });
        emit PythFeedProposed(collection, feedId, block.timestamp + FEED_ROTATION_TIMELOCK);
    }

    /// @notice Cancel a staged feed rotation.
    function cancelPendingPythFeed(address collection) external onlyOperator {
        delete _pendingFeeds[collection];
        emit PythFeedProposalCancelled(collection);
    }

    /// @notice Read a staged feed rotation, if any.
    function pendingPythFeed(
        address collection
    ) external view returns (bytes32 feedId, uint256 maxStaleness, uint64 maxConfidence, uint256 effective) {
        PendingFeed memory p = _pendingFeeds[collection];
        return (p.feedId, p.maxStaleness, p.maxConfidence, p.effective);
    }

    /// @notice Attach `IMarketCalendar` for session-aware staleness widening when markets are closed.
    event MarketCalendarUpdated(address indexed calendar);
    /// @notice Emitted when a feed rotation is staged via `proposePythFeed`.
    event PythFeedProposed(address indexed collection, bytes32 indexed feedId, uint256 effective);
    /// @notice Emitted when a staged feed rotation is cancelled.
    event PythFeedProposalCancelled(address indexed collection);

    function setMarketCalendar(address _calendar) external onlyAdmin {
        if (_calendar == address(0)) revert ZeroAddress();
        marketCalendar = IMarketCalendar(_calendar);
        emit MarketCalendarUpdated(_calendar);
    }

    /// @notice Map a collection address to a calendar `marketId` string.
    function setMarketId(address collection, string memory marketId) external onlyOperator {
        // Cap length to keep storage writes and `bytes(...).length` reads bounded.
        if (bytes(marketId).length > MAX_MARKET_ID_BYTES) revert MarketIdTooLong();
        marketIds[collection] = marketId;
    }

    /// @inheritdoc IOracleAggregator
    function configureBreaker(
        address collection,
        DataTypes.BreakerType breakerType,
        uint256 threshold,
        uint256 windowSeconds,
        uint256 cooldownSeconds
    ) external onlyOperator {
        CircuitBreakerLib.configureBreaker(
            collection,
            breakerType,
            threshold,
            windowSeconds,
            cooldownSeconds,
            _breakerConfigs
        );
    }

    /// @inheritdoc IOracleAggregator
    function setBreakerEnabled(
        address collection,
        DataTypes.BreakerType breakerType,
        bool enabled
    ) external onlyOperator {
        _breakerConfigs[collection][breakerType].enabled = enabled;
        emit BreakerEnabledUpdated(collection, breakerType, enabled);
    }

    /// @inheritdoc IOracleAggregator
    function registerPausable(address target) external onlyAdmin {
        if (target == address(0)) revert ZeroAddress();
        if (!_pausables[target]) {
            // Enforce a hard cap on the registered list so iteration
            // during the emergency-pause execution stays bounded.
            if (_pausableList.length >= MAX_PAUSABLES) revert TooManyPausables();
            _pausables[target] = true;
            _pausableList.push(target);
        }
    }

    /// @inheritdoc IOracleAggregator
    function setGuardianQuorum(uint256 quorum) external onlyAdmin {
        // Tightened: minimum 3 (was 1). A single guardian must not be able
        // to drive the entire emergency-pause + price-override surface.
        if (quorum < 3 || quorum > 20) revert InvalidSource();
        guardianQuorum = quorum;
    }

    /// @inheritdoc IOracleAggregator
    function setEmergencyPriceQuorum(uint256 quorum) external onlyAdmin {
        // Tightened: minimum of 3 confirmers for emergency price overrides
        // (was 2). With FAST_TRACK_QUORUM_MULTIPLIER = 2, the fast-track
        // path now requires at least 6 guardian signatures.
        if (quorum < 3 || quorum > 20) revert InvalidSource();
        emergencyPriceQuorum = quorum;
    }

    /// @inheritdoc IOracleAggregator
    function addSupportedMarket(address collection) external onlyAdmin {
        _supportedAssets.push(collection);
    }

    /// @inheritdoc IOracleAggregator
    function proposeEmergencyPrice(
        address collection,
        uint256 price,
        uint256 validUntil
    ) external onlyGuardian returns (bytes32 proposalId) {
        unchecked {
            ++_emergencyPriceProposalNonce;
        }
        return
            EmergencyPriceLib.proposeEmergencyPrice(
                collection,
                price,
                validUntil,
                _emergencyPriceProposalNonce,
                _emergencyPriceProposals,
                _lastEmergencyPriceProposalAt,
                emergencyPriceProposalMinInterval
            );
    }

    event EmergencyPriceProposalMinIntervalUpdated(uint256 newInterval);

    /// @notice Admin-tunable per-guardian per-market rate limit on
    ///         `proposeEmergencyPrice`. Bounded `[10 minutes, 24 hours]`.
    function setEmergencyPriceProposalMinInterval(uint256 newInterval) external onlyAdmin {
        if (newInterval < 10 minutes || newInterval > 24 hours) revert InvalidSource();
        emergencyPriceProposalMinInterval = newInterval;
        emit EmergencyPriceProposalMinIntervalUpdated(newInterval);
    }

    /// @inheritdoc IOracleAggregator
    function confirmEmergencyPrice(bytes32 proposalId) external onlyGuardian {
        EmergencyPriceLib.confirmEmergencyPrice(
            proposalId,
            emergencyPriceQuorum,
            _emergencyPriceProposals,
            _manualPrices,
            _manualPriceExpiry,
            _pendingManualPrices,
            address(this)
        );
    }

    /// @notice Promote a staged emergency price override after the 24h timelock . Permissionless.
    /// @dev Re-validates against Pyth at apply time; reverts if the oracle
    ///      has moved beyond the deviation cap since the proposal was staged.
    function applyPendingEmergencyPrice(address collection) external {
        EmergencyPriceLib.applyPendingEmergencyPrice(
            collection,
            _manualPrices,
            _manualPriceExpiry,
            _pendingManualPrices,
            address(this)
        );
    }

    /// @notice Cancel a staged emergency price override before activation. Guardian-controlled.
    function cancelPendingEmergencyPrice(address collection) external onlyGuardian {
        EmergencyPriceLib.cancelPendingEmergencyPrice(collection, _pendingManualPrices);
    }

    /// @notice Emitted when an admin force-clears an active manual price override.
    event ManualPriceCleared(address indexed collection, address indexed clearedBy);

    /// @notice Kill-switch: immediately revoke an ACTIVE manual price
    ///         override (and any staged one) for `collection`, restoring the
    ///         live Pyth read on the next price query.
    /// @dev Admin-only. The emergency-price override is a high-trust lever: it
    ///      can move close-out value and vault NAV by up to the deviation cap
    ///      while active, and is set by a guardian quorum. This gives a SEPARATE
    ///      role (ADMIN) an immediate revocation path so a colluding/erroneous
    ///      guardian quorum cannot pin a price for the full validity window —
    ///      admin can drop it in one transaction without waiting for expiry.
    ///      TWAP sampling (`recordPricePoint`) resumes automatically once the
    ///      override is cleared.
    function clearManualPrice(address collection) external onlyAdmin {
        delete _manualPrices[collection];
        delete _manualPriceExpiry[collection];
        delete _pendingManualPrices[collection];
        emit ManualPriceCleared(collection, msg.sender);
    }

    /// @notice Read the active manual override price and expiry, if any.
    /// @return price Active override price (0 if none).
    /// @return expiry Timestamp at which the active override lapses.
    function getManualPrice(address collection) external view returns (uint256 price, uint256 expiry) {
        return (_manualPrices[collection], _manualPriceExpiry[collection]);
    }

    /// @notice Read-only view of a pending (staged) emergency price override.
    function getPendingEmergencyPrice(
        address collection
    ) external view returns (uint256 price, uint256 validUntil, uint256 effectiveTime) {
        EmergencyPriceLib.PendingPriceOverride memory p = _pendingManualPrices[collection];
        return (p.price, p.validUntil, p.effectiveTime);
    }

    /// @notice True when a manual emergency-price override is currently
    ///         active for `collection`. Trading paths use this to refuse
    ///         risk-increasing actions (opens, liquidations) while the
    ///         override is in effect, so a guardian-set price cannot be
    ///         exploited to mass-liquidate one side of the book.
    function isManualPriceActive(address collection) external view returns (bool) {
        return _manualPrices[collection] > 0 && block.timestamp <= _manualPriceExpiry[collection];
    }

    /// @inheritdoc IOracleAggregator
    function getBreakerStatus(
        address collection,
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerStatus memory) {
        return _breakerStatuses[collection][breakerType];
    }

    /// @inheritdoc IOracleAggregator
    function getBreakerConfig(
        address collection,
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerConfig memory) {
        return _breakerConfigs[collection][breakerType];
    }

    /// @inheritdoc IOracleAggregator
    function isMarketRestricted(address collection) external view returns (bool isRestricted, uint256 activeBreakers) {
        if (_isGloballyPausedView()) {
            isRestricted = true;
        }

        uint8 breakerTypeCount = uint8(DataTypes.BreakerType.EMERGENCY) + 1;
        for (uint8 i = 0; i < breakerTypeCount; ) {
            DataTypes.BreakerType breakerType = DataTypes.BreakerType(i);
            DataTypes.BreakerStatus storage status = _breakerStatuses[collection][breakerType];

            if (status.state == DataTypes.BreakerState.TRIGGERED) {
                unchecked {
                    ++activeBreakers;
                }
                isRestricted = true;
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @inheritdoc IOracleAggregator
    function getHistoricalPrice(address collection, uint256 hoursAgo) external view returns (uint256) {
        uint256 timestamp = block.timestamp - (hoursAgo * 1 hours);
        uint256 price = _historicalPrices[collection][timestamp / 5 minutes];
        if (price == 0) revert DataNotFound();
        return price;
    }

    /// @inheritdoc IOracleAggregator
    function getOracleConfig(address collection) external view returns (bytes32, uint256, uint256, uint256) {
        OracleConfig memory c = _configs[collection];
        return (c.feedId, c.maxStaleness, c.minPrice, c.maxPrice);
    }

    /// @inheritdoc IOracleAggregator
    function getPausableList() external view returns (address[] memory) {
        return _pausableList;
    }

    /// @inheritdoc IOracleAggregator
    function getSupportedMarkets() external view returns (address[] memory) {
        return _supportedAssets;
    }

    /// @inheritdoc IOracleAggregator
    function getGuardianQuorum() external view override returns (uint256) {
        return guardianQuorum;
    }

    function _normalizePythPrice(int64 price, int32 expo) internal pure returns (uint256) {
        if (price <= 0) return 0;

        uint256 p = uint256(int256(price));

        int256 decimalDiff = 18 + int256(expo);
        // overflow `10**decimalDiff`. Pyth feeds in production use negative
        // expos (~ -8 typical, -18 worst case for high-precision feeds); a
        // window of [-30, 30] is intentionally generous.
        if (decimalDiff > 30 || decimalDiff < -30) revert PriceOutOfBounds();

        if (decimalDiff >= 0) {
            return p * (10 ** uint256(decimalDiff));
        } else {
            return p / (10 ** uint256(-decimalDiff));
        }
    }

    /// @dev Unsigned-only normalization for Pyth confidence values. Mirrors
    ///      `_normalizePythPrice` exponent handling without the signed
    ///      detour. Returns 0 on empty input rather than reverting because
    ///      callers compare against `maxConfidence` and zero is the
    ///      "no data" sentinel they already handle.
    function _normalizePythConfidence(uint256 conf, int32 expo) internal pure returns (uint256) {
        if (conf == 0) return 0;
        int256 decimalDiff = 18 + int256(expo);
        if (decimalDiff > 30 || decimalDiff < -30) revert PriceOutOfBounds();
        if (decimalDiff >= 0) {
            return conf * (10 ** uint256(decimalDiff));
        } else {
            uint256 normalized = conf / (10 ** uint256(-decimalDiff));
            // A non-zero raw confidence that floors to zero must not be
            // reported as "no data" (zero), which would silently pass the
            // `normalizedConf > maxConfidence` gate. Floor to 1 so a genuine —
            // if tiny — uncertainty band is always represented.
            return normalized == 0 ? 1 : normalized;
        }
    }

    function _recordPrice(address collection, uint256 price) internal {
        _historicalPrices[collection][block.timestamp / 5 minutes] = price;
        _lastPriceTime[collection] = block.timestamp;
    }
}
