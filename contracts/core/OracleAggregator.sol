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

/**
 * @title OracleAggregator
 * @notice Pyth-backed prices per market address, TWAP ring buffer, circuit breakers, emergency pause/price governance, and trading gating hooks.
 * @dev Implements `IOracleAggregator`; parameter names use `collection` internally as the keyed market address.
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
    uint256 private constant MIN_TWAP_UPDATE_INTERVAL = 5 minutes;
    uint256 public constant PRICE_OVERRIDE_DELAY = 24 hours;
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

    IMarketCalendar public marketCalendar;
    mapping(address => string) public marketIds;

    /// @dev Activation timestamp of `_globalPause` when raised via the
    ///      single-guardian fast path (`activateGlobalPause`). Permits permissionless
    ///      auto-expiry after `GLOBAL_PAUSE_AUTO_EXPIRY` to avoid indefinite halts.
    uint256 public globalPauseActivatedAt;

    uint256[20] private __gap;

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
        emergencyPriceQuorum = 2;
        sequencerGracePeriod = 30 minutes;
        guardianQuorum = 2;
    }

    /// @custom:oz-upgrades From `UUPSUpgradeable`: only admin may authorize implementation upgrades.
    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {}

    function _getPriceView(
        address collection
    ) internal view returns (uint256 price, uint256 confidence, uint256 timestamp) {
        if (_manualPrices[collection] > 0 && block.timestamp <= _manualPriceExpiry[collection]) {
            OracleConfig memory manualConfig = _configs[collection];
            uint256 manualPrice = _manualPrices[collection];
            if (manualConfig.minPrice > 0 && manualPrice < manualConfig.minPrice) revert PriceOutOfBounds();
            if (manualConfig.maxPrice > 0 && manualPrice > manualConfig.maxPrice) revert PriceOutOfBounds();
            return (manualPrice, PRECISION, block.timestamp);
        }

        OracleConfig memory config = _configs[collection];
        if (config.feedId == bytes32(0)) revert InvalidSource();

        try pyth.getPriceUnsafe(config.feedId) returns (PythStructs.Price memory pythPrice) {
            uint256 maxStale = config.maxStaleness > 0 ? config.maxStaleness : defaultMaxStaleness;

            if (address(marketCalendar) != address(0)) {
                string memory mId = marketIds[collection];
                if (bytes(mId).length > 0 && !marketCalendar.isMarketOpen(mId)) {
                    maxStale = 4 days;
                }
            }

            if (block.timestamp > pythPrice.publishTime + maxStale) revert StalePrice();
            if (pythPrice.price <= 0) revert InvalidSource();

            uint256 normalizedPrice = _normalizePythPrice(pythPrice.price, pythPrice.expo);
            uint256 normalizedConf = _normalizePythPrice(int64(uint64(pythPrice.conf)), pythPrice.expo);

            if (config.maxConfidence > 0) {
                if (normalizedConf > config.maxConfidence) revert InsufficientConfidence();
            } else {
                // tightened default from 2% to 0.5% confidence band when operators have
                // not configured a feed-specific cap.
                if (normalizedConf > normalizedPrice / 200) revert InsufficientConfidence();
            }

            if (config.minPrice > 0 && normalizedPrice < config.minPrice) revert PriceOutOfBounds();
            if (config.maxPrice > 0 && normalizedPrice > config.maxPrice) revert PriceOutOfBounds();

            return (normalizedPrice, normalizedConf, pythPrice.publishTime);
        } catch {
            revert DataNotFound();
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
        if (confidence > maxUncertainty) revert InsufficientConfidence();
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
    function getValidSourceCount(address collection) external view returns (uint256) {
        if (_configs[collection].feedId == bytes32(0)) return 0;
        (bool healthy, ) = isOracleHealthy(collection);
        return healthy ? 1 : 0;
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
        if (!_globalPause) {
            _globalPause = true;
            // Stamp the time so the protocol can permissionlessly
            // resume after `GLOBAL_PAUSE_AUTO_EXPIRY` if no admin/guardian action
            // re-arms it. This bounds single-guardian halts.
            globalPauseActivatedAt = block.timestamp;
            emit GlobalPauseActivated(msg.sender);
        }
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
            unchecked { ++i; }
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
        _configs[collection].feedId = feedId;
        _configs[collection].maxStaleness = maxStaleness;
        _configs[collection].maxConfidence = maxConfidence;
        emit PythFeedSet(collection, feedId);
    }

    /// @notice Attach `IMarketCalendar` for session-aware staleness widening when markets are closed.
    function setMarketCalendar(address _calendar) external onlyAdmin {
        if (_calendar == address(0)) revert ZeroAddress();
        marketCalendar = IMarketCalendar(_calendar);
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
        // must be >= 1 to avoid disabling pause altogether.
        if (quorum < 1 || quorum > 20) revert InvalidSource();
        guardianQuorum = quorum;
    }

    /// @inheritdoc IOracleAggregator
    function setEmergencyPriceQuorum(uint256 quorum) external onlyAdmin {
        // enforce a minimum of 2 confirmers for emergency price overrides.
        if (quorum < 2 || quorum > 20) revert InvalidSource();
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
                _emergencyPriceProposals
            );
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
    function applyPendingEmergencyPrice(address collection) external {
        EmergencyPriceLib.applyPendingEmergencyPrice(
            collection,
            _manualPrices,
            _manualPriceExpiry,
            _pendingManualPrices
        );
    }

    /// @notice Cancel a staged emergency price override before activation. Guardian-controlled.
    function cancelPendingEmergencyPrice(address collection) external onlyGuardian {
        EmergencyPriceLib.cancelPendingEmergencyPrice(collection, _pendingManualPrices);
    }

    /// @notice Read-only view of a pending (staged) emergency price override.
    function getPendingEmergencyPrice(
        address collection
    ) external view returns (uint256 price, uint256 validUntil, uint256 effectiveTime) {
        EmergencyPriceLib.PendingPriceOverride memory p = _pendingManualPrices[collection];
        return (p.price, p.validUntil, p.effectiveTime);
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

        if (decimalDiff >= 0) {
            return p * (10 ** uint256(decimalDiff));
        } else {
            return p / (10 ** uint256(-decimalDiff));
        }
    }

    function _recordPrice(address collection, uint256 price) internal {
        _historicalPrices[collection][block.timestamp / 5 minutes] = price;
        _lastPriceTime[collection] = block.timestamp;
    }
}
