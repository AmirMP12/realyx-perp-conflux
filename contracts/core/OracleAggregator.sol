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
 * @notice Unified price oracle and circuit breaker system using Pyth Network
 * @dev Consolidates OracleAggregator + CircuitBreakerHub into single contract
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

    modifier onlyOracleOrKeeper() {
        if (!hasRole(ORACLE_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender)) revert NotOracleOrKeeper();
        _;
    }

    event EmergencyPriceProposed(bytes32 indexed proposalId, address indexed collection, uint256 price, address indexed proposer);
    event BreakerEnabledUpdated(address indexed collection, DataTypes.BreakerType breakerType, bool enabled);
    event CircuitBreakerAlert(address indexed collection, DataTypes.BreakerType breakerType, uint256 threshold, uint256 currentValue);

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

    uint256[21] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        /* _disableInitializers(); */
    }
    
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
    
    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {}

    function _getPriceView(address collection) internal view returns (uint256 price, uint256 confidence, uint256 timestamp) {
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
                  if (normalizedConf > normalizedPrice / 50) revert InsufficientConfidence();
            }

            if (config.minPrice > 0 && normalizedPrice < config.minPrice) revert PriceOutOfBounds();
            if (config.maxPrice > 0 && normalizedPrice > config.maxPrice) revert PriceOutOfBounds();

            return (normalizedPrice, normalizedConf, pythPrice.publishTime);

        } catch {
             revert DataNotFound();
        }
    }

    function getPrice(address collection) public view returns (uint256 price, uint256 confidence, uint256 timestamp) {
        return _getPriceView(collection);
    }
    
    function getPriceWithConfidence(address collection, uint256 maxUncertainty) external view returns (uint256 price) {
        uint256 confidence;
        (price, confidence,) = _getPriceView(collection);
        if (confidence > maxUncertainty) revert InsufficientConfidence();
    }
    
    function getTWAP(address collection, uint256 windowSeconds) public view returns (uint256 twapPrice) {
        TWAPBuffer storage buffer = _twapBuffers[collection];
        if (buffer.count == 0) {
            (twapPrice,,) = _getPriceView(collection);
            return twapPrice;
        }
        return OracleAggregatorLib.calculateTWAP(buffer.points, buffer.head, buffer.count, windowSeconds, block.timestamp);
    }
    
    function getTWAPWithValidation(address collection, uint256 windowSeconds, uint256 minDataPoints) public view returns (uint256 twapPrice, bool isValid) {
        TWAPBuffer storage buffer = _twapBuffers[collection];
        if (buffer.count == 0) {
            (twapPrice,,) = _getPriceView(collection);
            return (twapPrice, false);
        }
        uint256 dataPointCount;
        (twapPrice, dataPointCount) = OracleAggregatorLib.calculateTWAPWithCount(buffer.points, buffer.head, buffer.count, windowSeconds, block.timestamp);
        isValid = dataPointCount >= minDataPoints;
    }
    
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
    
    function setEthFeedId(bytes32 _feedId) external onlyOperator {
        ethFeedId = _feedId;
    }
    
    function getValidSourceCount(address collection) external view returns (uint256) {
        if (_configs[collection].feedId == bytes32(0)) return 0;
        (bool healthy,) = isOracleHealthy(collection);
        return healthy ? 1 : 0;
    }

    function recordPricePoint(address collection, uint256) external onlyOracleOrKeeper {
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
            unchecked { ++buffer.count; }
        }
        
        emit TWAPUpdated(collection, getTWAP(collection, DEFAULT_TWAP_WINDOW), DEFAULT_TWAP_WINDOW);
    }

    function checkBreakers(
        address collection, 
        uint256 currentPrice, 
        uint256
    ) external nonReentrant returns (bool triggered) {
        _recordPrice(collection, currentPrice);
        DataTypes.BreakerConfig memory priceDropConfig = _breakerConfigs[collection][DataTypes.BreakerType.PRICE_DROP];
        if (CircuitBreakerLib.checkPriceDropBreaker(collection, currentPrice, _breakerConfigs, _breakerStatuses, _historicalPrices)) {
            triggered = true;
            emit CircuitBreakerAlert(collection, DataTypes.BreakerType.PRICE_DROP, priceDropConfig.threshold, currentPrice);
        }
        DataTypes.BreakerConfig memory twapConfig = _breakerConfigs[collection][DataTypes.BreakerType.TWAP_DEVIATION];
        if (twapConfig.enabled) {
            uint256 twap = getTWAP(collection, twapConfig.windowSeconds);
            if (CircuitBreakerLib.checkTWAPDeviationBreaker(collection, currentPrice, twap, _breakerConfigs, _breakerStatuses)) {
                triggered = true;
                emit CircuitBreakerAlert(collection, DataTypes.BreakerType.TWAP_DEVIATION, twapConfig.threshold, currentPrice);
            }
        }
    }
    
    function triggerBreaker(address collection, DataTypes.BreakerType breakerType) external onlyGuardian {
        CircuitBreakerLib.triggerBreaker(collection, breakerType, _breakerConfigs, _breakerStatuses);
    }
    
    function resetBreaker(address collection, DataTypes.BreakerType breakerType) external onlyAdminOrGuardian {
        CircuitBreakerLib.resetBreaker(collection, breakerType, hasRole(ADMIN_ROLE, msg.sender), _breakerStatuses);
    }
    
    function autoResetBreakers(address collection) external whenNotPaused {
        (bool healthy,) = isOracleHealthy(collection);
        if (!healthy) return;
        CircuitBreakerLib.autoResetBreakers(collection, _breakerStatuses);
    }
    
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
    
    function isActionAllowed(address collection, uint8 actionType) external view returns (bool) {
        return CircuitBreakerLib.isActionAllowed(collection, actionType, _globalPause, _breakerStatuses);
    }

    function proposeEmergencyPause(address[] calldata targets, string calldata) external onlyGuardian returns (bytes32 pauseId) {
        return EmergencyPauseLib.proposeEmergencyPause(targets, _pauseProposals);
    }
    
    function confirmEmergencyPause(bytes32 pauseId) external onlyGuardian {
        EmergencyPauseLib.confirmEmergencyPause(pauseId, guardianQuorum, _pauseProposals, _pausables, failedPauses, _failedPauseList);
        failedPauseCount = _failedPauseList.length;
    }
    
    function activateGlobalPause() external onlyGuardian {
        if (!_globalPause) {
            _globalPause = true;
            emit GlobalPauseActivated(msg.sender);
        }
    }
    
    function deactivateGlobalPause() external onlyAdmin {
        if (_globalPause) {
            _globalPause = false;
            emit GlobalPauseDeactivated(msg.sender);
        }
    }
    
    function isGloballyPaused() external view returns (bool) { return _globalPause; }

    function setPythFeed(
        address collection, 
        bytes32 feedId, 
        uint256 maxStaleness,
        uint64 maxConfidence
    ) external onlyOperator {
        _configs[collection].feedId = feedId;
        _configs[collection].maxStaleness = maxStaleness;
        _configs[collection].maxConfidence = maxConfidence;
        emit PythFeedSet(collection, feedId);
    }
    
    function setMarketCalendar(address _calendar) external onlyAdmin {
        if (_calendar == address(0)) revert ZeroAddress();
        marketCalendar = IMarketCalendar(_calendar);
    }

    function setMarketId(address collection, string memory marketId) external onlyOperator {
        marketIds[collection] = marketId;
    }
    
    function configureBreaker(
        address collection, 
        DataTypes.BreakerType breakerType, 
        uint256 threshold, 
        uint256 windowSeconds, 
        uint256 cooldownSeconds
    ) external onlyOperator {
        CircuitBreakerLib.configureBreaker(collection, breakerType, threshold, windowSeconds, cooldownSeconds, _breakerConfigs);
    }
    
    function setBreakerEnabled(
        address collection, 
        DataTypes.BreakerType breakerType, 
        bool enabled
    ) external onlyOperator {
        _breakerConfigs[collection][breakerType].enabled = enabled;
        emit BreakerEnabledUpdated(collection, breakerType, enabled);
    }
    
    function registerPausable(address target) external onlyAdmin {
        if (!_pausables[target]) {
            _pausables[target] = true;
            _pausableList.push(target);
        }
    }
    
    function setGuardianQuorum(uint256 quorum) external onlyAdmin {
        guardianQuorum = quorum;
    }
    
    function addSupportedMarket(address collection) external onlyAdmin {
        _supportedAssets.push(collection);
    }
    
    function proposeEmergencyPrice(
        address collection, 
        uint256 price, 
        uint256 validUntil
    ) external onlyGuardian returns (bytes32 proposalId) {
        unchecked { ++_emergencyPriceProposalNonce; }
        return EmergencyPriceLib.proposeEmergencyPrice(collection, price, validUntil, _emergencyPriceProposalNonce, _emergencyPriceProposals);
    }
    
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

    function getBreakerStatus(
        address collection, 
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerStatus memory) {
        return _breakerStatuses[collection][breakerType];
    }
    
    function getBreakerConfig(
        address collection, 
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerConfig memory) {
        return _breakerConfigs[collection][breakerType];
    }
    
    function isMarketRestricted(address collection) external view returns (bool isRestricted, uint256 activeBreakers) {
        if (_globalPause) {
            isRestricted = true;
        }

        uint8 breakerTypeCount = uint8(DataTypes.BreakerType.EMERGENCY) + 1;
        for (uint8 i = 0; i < breakerTypeCount;) {
            DataTypes.BreakerType breakerType = DataTypes.BreakerType(i);
            DataTypes.BreakerStatus storage status = _breakerStatuses[collection][breakerType];

            if (status.state == DataTypes.BreakerState.TRIGGERED) {
                unchecked { ++activeBreakers; }
                isRestricted = true;
            }
            unchecked { ++i; }
        }
    }
    
    function getHistoricalPrice(address collection, uint256 hoursAgo) external view returns (uint256) {
        uint256 timestamp = block.timestamp - (hoursAgo * 1 hours);
        uint256 price = _historicalPrices[collection][timestamp / 5 minutes];
        if (price == 0) revert DataNotFound();
        return price;
    }
    
    function getOracleConfig(address collection) external view returns (bytes32, uint256, uint256, uint256) {
        OracleConfig memory c = _configs[collection];
        return (c.feedId, c.maxStaleness, c.minPrice, c.maxPrice);
    }
    
    function getPausableList() external view returns (address[] memory) { return _pausableList; }
    
    function getSupportedMarkets() external view returns (address[] memory) { return _supportedAssets; }
    
    function getGuardianQuorum() external view override returns (uint256) { return guardianQuorum; }

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
