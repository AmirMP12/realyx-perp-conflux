// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../base/AccessControlled.sol";
import "../interfaces/ITradingCore.sol";
import "../interfaces/IVaultCore.sol";
import "../interfaces/IOracleAggregator.sol";
import "../interfaces/IPositionToken.sol";
import "../interfaces/IMarketCalendar.sol";
import "../interfaces/IDividendManager.sol";
import "../interfaces/IComplianceManager.sol";
import "../libraries/DataTypes.sol";
import "../libraries/FeeCalculator.sol";
import "../libraries/DustLib.sol";
import "../libraries/FlashLoanCheck.sol";
import "../libraries/FundingLib.sol";
import "../libraries/HealthLib.sol";
import "../libraries/WithdrawLib.sol";
import "../libraries/TradingLib.sol";
import "./CollateralRegistry.sol";
import "../libraries/PortfolioRiskLib.sol";
import "../libraries/ConfigLib.sol";
import "../libraries/TradingContextLib.sol";
import "../libraries/RateLimitLib.sol";
import "../libraries/PositionTriggersLib.sol";
import "../libraries/CleanupLib.sol";
import "../libraries/Events.sol";

/**
 * @title TradingCore
 * @notice Upgradeable perpetual futures engine: positions, keeper-driven orders, funding, collateral, and vault/oracle integration.
 * @dev Heavy logic lives in libraries (`TradingLib`, `FundingLib`, …). Several views delegate to `tradingViews` when set; unset reverts on those reads.
 */
/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract TradingCore is Initializable, UUPSUpgradeable, ReentrancyGuardUpgradeable, AccessControlled, ITradingCore {
    using SafeERC20 for IERC20;

    error NotPositionOwner();
    error InsufficientCollateral();
    error FlashLoanDetected();
    error DeadlineExpired();
    error BreakerActive();

    error PositionTooSmall();
    error NotPositionToken();
    error ProtocolUnhealthy();
    error InsufficientOracleSources();
    error PositionNotFound();
    error Unauthorized();
    error ComplianceCheckFailed();
    error MarketClosed();
    /// @dev Errors for the new RWA-contracts timelock surface.
    error PendingRWAMismatch();
    error RWATimelockActive();
    /// @dev Configuration bound checks.
    error InvalidParam();
    /// @dev Alt-collateral lifecycle (open/close/liquidate fee accounting) is
    ///      not currently safe to enable. Trades MUST use the canonical USDC
    ///      collateral path until the alt-collateral fee + repay flow is
    ///      redesigned end-to-end. This guard is checked at every entry that
    ///      accepts a `collateralToken` argument to prevent partially-initialized
    ///      alt positions from being created and then becoming unclosable.
    error AltCollateralDisabled();
    error PortfolioRiskViolation();
    /// @dev Advanced order-type errors.
    error PostOnlyNotAllowedForMarket();
    error PostOnlyCrossesBook();
    error ReduceOnlyRequiresPosition();
    error InvalidVisibleSize();
    error IocFokNotFilled();
    /// @dev IOC/FOK time-in-force directives are accepted by the struct for
    ///      forward-compatibility but the keeper executor does not yet
    ///      implement immediate-or-cancel / fill-or-kill semantics. Reject at
    ///      creation so callers are never misled into believing an IOC/FOK
    ///      order will not rest on the book (it would otherwise behave as GTC).
    error UnsupportedTimeInForce();
    error InvalidOraclePrice();
    error SubaccountNotApproved();

    uint256 private constant PRECISION = DataTypes.PRECISION;
    uint256 private constant BPS = DataTypes.BPS_PRECISION;
    uint256 private constant MAX_CLEANUP = 20;
    uint256 private constant MAX_TRAILING_BPS = 5000;
    uint256 public constant MAX_ACTIVE_MARKETS = 20;

    IERC20 public usdc;
    IVaultCore public vaultCore;
    IOracleAggregator public oracleAggregator;
    IPositionToken public positionToken;
    address public treasury;

    /// @inheritdoc ITradingCore
    uint256 public nextPositionId;
    DataTypes.FeeConfig public feeConfig;
    DataTypes.LiquidationFeeTiers public liquidationTiers;
    mapping(uint256 => DataTypes.Position) private _positions;
    mapping(uint256 => DataTypes.PositionCollateral) private _positionCollateral;
    mapping(address => uint256[]) private _userPositions;
    mapping(address => DataTypes.Market) private _markets;
    mapping(address => DataTypes.FundingState) private _fundingStates;
    mapping(uint256 => DataTypes.Order) private _orders;
    uint256 private _nextOrderId;
    mapping(address => uint256) private _lastInteractionBlock;
    mapping(address => uint256) private _lastLargeActionTime;
    mapping(address => mapping(uint256 => uint256)) private _userDailyVolume;
    mapping(uint256 => uint256) private _globalDailyVolume;
    mapping(address => uint256) private _userExposure;
    mapping(uint256 => int256) private _positionCumulativeFunding;
    DataTypes.ProtocolHealthState public protocolHealth;
    DataTypes.DustAccumulator public dustAccumulator;
    uint256 public largeActionThreshold;
    uint256 public largeActionInterval;
    uint256 public userDailyVolumeLimit;
    uint256 public globalDailyVolumeLimit;
    uint256 public maxUserExposure;
    uint256 public minPositionSize;
    uint256 public maxOracleUncertainty;
    uint256 public minPositionDuration;
    uint256 private _globalBlockInteractions;
    uint256 private _lastGlobalInteractionBlock;
    uint256 public maxActionsPerBlock;
    mapping(address => bool) public trustedForwarders;

    uint256 public minExecutionFee;
    uint256 public maxPositionsPerUser;
    mapping(address => uint256) private _lastInteractionTimestamp;
    uint256 public minInteractionDelay;

    uint256 public liquidationDeviationBps;
    mapping(uint256 => DataTypes.FailedRepayment) private _failedRepayments;
    uint256[] private _failedRepaymentIds;
    mapping(uint256 => uint256) private _failedRepaymentIndex;
    uint256 public totalFailedRepayments;

    mapping(address => uint256) private _keeperFeeBalance;
    mapping(address => uint256) private _orderRefundBalance;
    mapping(address => uint256) private _orderCollateralRefundBalance;
    mapping(address => mapping(address => uint256)) private _orderCollateralTokenRefundBalance;

    IMarketCalendar public marketCalendar;
    IDividendManager public dividendManager;
    mapping(address => string) public marketIds;
    mapping(uint256 => uint256) public positionDividendIndex;

    IComplianceManager public complianceManager;
    CollateralRegistry public collateralRegistry;

    address[] private _activeMarkets;
    mapping(address => bool) private _isMarketActive;

    address public tradingViews;

    /// @dev Pending RWA contract rotation under 48h timelock to
    ///      mitigate single-key admin compromise that could disable compliance,
    ///      swap dividend manager mid-flight, or re-open closed markets.
    address private _pendingRWACalendar;
    address private _pendingRWADividendManager;
    address private _pendingRWACompliance;
    uint256 private _pendingRWAEffective;
    uint256 private constant RWA_TIMELOCK = 48 hours;

    /// @dev Admin-tunable funding interval cap. Defaults to
    ///      `DataTypes.MAX_FUNDING_INTERVALS` (24 = 8 days). Setting this higher
    ///      lets a guardian force-catch-up a long-dormant market without an upgrade.
    ///      Bounded to a sane upper limit (10x default = 240 intervals = 80 days).
    uint256 public maxFundingIntervals;

    /// @dev Configurable liquidator-reward floor. Replaces the
    ///      hard-coded `10e6` USDC absolute minimum so testnet/sandbox
    ///      operations do not falsely trip the protective check.
    uint256 public minLiquidatorRewardUsdc;
    bool public crossMarginByDefault;
    DataTypes.PortfolioRiskConfig public portfolioRiskConfig;

    /// @dev High-water (long) / low-water (short) anchor for trailing-stop triggers.
    mapping(uint256 => uint256) private _trailingAnchorPrice;

    mapping(uint256 => DataTypes.BasketAllocation) private _positionBaskets;

    /// @dev Subaccount delegation: `isSubaccount[owner][bot] == true` means `bot` can trade on behalf of `owner`.
    mapping(address => mapping(address => bool)) public isSubaccount;

    /// @dev Optional ReferralRegistry. When zero, the protocol charges
    ///      base-tier fees with no referrer rebate. Hot-path lookups are O(1).
    address public referralRegistry;

    // ─── Storage extensions (appended to preserve layout) ───
    /// @dev Latches `true` after the first successful first-time RWA wire-up
    ///      so subsequent rotations always go through the 48h timelock, even
    ///      if a future upgrade clears all three pointers.
    bool private _rwaContractsInitialized;
    /// @dev Staged referral registry rotation under 48h timelock.
    address private _pendingReferralRegistry;
    uint256 private _pendingReferralRegistryEffective;

    /// @dev Tracks the actual payer of the keeper execution fee per order.
    ///      For subaccount-delegated orders the bot funds the fee but the
    ///      order is owned by `effectiveOwner`; on cancel the ETH refund
    ///      must go to the bot, not the owner.
    mapping(uint256 => address) private _orderExecutionFeePayer;

    uint256[9] private __gap;

    modifier noFlashLoan() {
        // Key the per-sender same-block lock and interaction-delay on the
        // ERC-2771-resolved signer, not the raw `msg.sender`. Otherwise every
        // user routed through one trusted forwarder shares a single per-block
        // lock, capping all meta-tx users to one action per block (a DoS).
        // Untrusted callers resolve to `msg.sender` unchanged, preserving the
        // same-block flash-loan defence.
        address flActor = _trustedSender();
        (_lastGlobalInteractionBlock, _globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            flActor,
            tx.origin,
            block.number,
            block.timestamp,
            hasRole(OPERATOR_ROLE, flActor),
            maxActionsPerBlock,
            minInteractionDelay,
            _lastInteractionBlock,
            trustedForwarders,
            _lastGlobalInteractionBlock,
            _globalBlockInteractions,
            _lastInteractionTimestamp
        );
        _;
    }

    modifier checkBreakersForOrder(uint256 orderId) {
        DataTypes.Order storage ord = _orders[orderId];
        if (ord.account != address(0)) {
            bool isIncrease = (ord.orderType == DataTypes.OrderType.MARKET_INCREASE ||
                ord.orderType == DataTypes.OrderType.LIMIT_INCREASE);
            if (isIncrease && !oracleAggregator.isActionAllowed(ord.market, 0)) revert BreakerActive();
        }
        _;
    }

    /// @notice For new risk-increasing orders: circuit breaker, protocol health, and large-size rate-limit *check* (no write).
    /// @dev The rate-limit budget is now CHECKED at order creation
    ///      and CONSUMED only at execution against `order.account`. Previously,
    ///      both creation and execution wrote `_lastLargeActionTime[trader]`,
    ///      collapsing throughput for legitimate users.
    modifier gateNewIncreaseOrder(DataTypes.OrderType orderType, address market, uint256 sizeDelta) {
        if (orderType == DataTypes.OrderType.MARKET_INCREASE || orderType == DataTypes.OrderType.LIMIT_INCREASE) {
            if (!oracleAggregator.isActionAllowed(market, 0)) revert BreakerActive();
            if (!protocolHealth.isHealthy) revert ProtocolUnhealthy();
            RateLimitLib.checkOnly(
                msg.sender,
                DataTypes.toInternalPrecision(sizeDelta),
                DataTypes.toInternalPrecision(largeActionThreshold),
                largeActionInterval,
                block.timestamp,
                _lastLargeActionTime
            );
        }
        _;
    }

    function _requireDeadline(uint256 d) internal view {
        if (block.timestamp > d) revert DeadlineExpired();
    }

    modifier checkProtocolHealth() {
        if (!protocolHealth.isHealthy) revert ProtocolUnhealthy();
        _;
    }

    modifier requireOracleSources(address c) {
        if (oracleAggregator.getValidSourceCount(c) < DataTypes.MIN_ORACLE_SOURCES) {
            revert InsufficientOracleSources();
        }
        _;
    }

    modifier checkCompliance(address market) {
        // ERC-2771 forwarder support: when the call comes through a
        // trusted forwarder, the last 20 bytes of calldata are the
        // original signer. The compliance check MUST be against that
        // signer, not the forwarder. Untrusted forwarders fall through
        // to `msg.sender` (the default).
        address user = _trustedSender();
        if (address(complianceManager) != address(0)) {
            if (!complianceManager.isAllowed(user, market, bytes(""))) revert ComplianceCheckFailed();
        }
        _;
    }

    /// @dev ERC-2771-aware sender resolution. When the caller is a
    ///      trusted forwarder we extract the original signer from the last
    ///      20 bytes of calldata; otherwise we return `msg.sender`. Used
    ///      by compliance and any other identity-sensitive gate.
    function _trustedSender() internal view returns (address sender) {
        if (msg.data.length >= 20 && trustedForwarders[msg.sender]) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time initializer for the UUPS implementation / proxy.
    /// @param admin AccessControl admin (DEFAULT_ADMIN).
    /// @param _usdc USDC token used as collateral.
    /// @param _treasury Address receiving protocol fee sweeps.
    function initialize(address admin, address _usdc, address _treasury) external initializer {
        if (admin == address(0) || _usdc == address(0) || _treasury == address(0)) revert ZeroAddress();

        __ReentrancyGuard_init();
        __AccessControlled_init(admin);
        __UUPSUpgradeable_init();

        _grantRole(TRADING_CORE_ROLE, address(this));

        usdc = IERC20(_usdc);
        treasury = _treasury;
        nextPositionId = 1;
        feeConfig = FeeCalculator.getDefaultFeeConfig();
        liquidationTiers = FeeCalculator.getDefaultLiquidationTiers();
        largeActionThreshold = 100_000e6;
        largeActionInterval = 300;
        userDailyVolumeLimit = 1_000_000e6;
        globalDailyVolumeLimit = 50_000_000e6;
        maxUserExposure = 500_000e6;
        minPositionSize = 100e6;
        maxOracleUncertainty = 8e17;
        minPositionDuration = 120;
        maxActionsPerBlock = 10;
        minExecutionFee = 0.005 ether;
        maxPositionsPerUser = 50;
        minInteractionDelay = 2;
        liquidationDeviationBps = 1000;
        protocolHealth.isHealthy = true;
        protocolHealth.lastHealthCheck = uint64(block.timestamp);
        dustAccumulator.sweepThreshold = DataTypes.DUST_THRESHOLD;
        dustAccumulator.lastSweepTimestamp = block.timestamp;
        _nextOrderId = 1;
        // Default initialization for funding/liquidator floors.
        maxFundingIntervals = DataTypes.MAX_FUNDING_INTERVALS;
        minLiquidatorRewardUsdc = 10e6;
        crossMarginByDefault = true;
        portfolioRiskConfig = DataTypes.PortfolioRiskConfig({
            maintenanceMarginBps: 500,
            concentrationLimitBps: 4000,
            maxCrossPositions: 20,
            enabled: true
        });
    }

    event ContractsUpdated(address indexed vault, address indexed oracle, address indexed positionToken);
    event CollateralRegistryUpdated(address indexed registry);
    event TradingViewsUpdated(address indexed views);
    event MarketCalendarUpdated(address indexed calendar);

    /// @notice Wire core external dependencies after deploy.
    /// @param _vc Vault used for borrow/repay and TVL health.
    /// @param _oa Oracle aggregator for prices and breakers.
    /// @param _pt ERC721 position token.
    function setContracts(address _vc, address _oa, address _pt) external onlyAdmin {
        if (_vc == address(0) || _oa == address(0) || _pt == address(0)) revert ZeroAddress();
        vaultCore = IVaultCore(_vc);
        oracleAggregator = IOracleAggregator(_oa);
        positionToken = IPositionToken(_pt);
        emit ContractsUpdated(_vc, _oa, _pt);
    }

    /// @notice Wire up the collateral registry.
    function setCollateralRegistry(address _cr) external onlyAdmin {
        if (_cr == address(0)) revert ZeroAddress();
        collateralRegistry = CollateralRegistry(_cr);
        emit CollateralRegistryUpdated(_cr);
    }

    event ReferralRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event ReferralRegistryProposed(address indexed pending, uint256 effective);

    error PendingReferralRegistryMismatch();
    error ReferralRegistryTimelockActive();

    uint256 private constant REFERRAL_REGISTRY_TIMELOCK = 48 hours;

    /// @notice Stage a referral registry rotation. Effective `REFERRAL_REGISTRY_TIMELOCK` later.
    /// @dev Pass `address(0)` to stage disabling the registry.
    function proposeReferralRegistry(address _registry) external onlyAdmin {
        _pendingReferralRegistry = _registry;
        _pendingReferralRegistryEffective = block.timestamp + REFERRAL_REGISTRY_TIMELOCK;
        emit ReferralRegistryProposed(_registry, _pendingReferralRegistryEffective);
    }

    /// @notice Apply a staged referral-registry rotation after the timelock.
    /// @dev The supplied `_registry` must exactly match the staged proposal,
    ///      preventing a swap-then-mismatch admin trick.
    function setReferralRegistry(address _registry) external onlyAdmin {
        if (_registry != _pendingReferralRegistry) revert PendingReferralRegistryMismatch();
        if (_pendingReferralRegistryEffective == 0 || block.timestamp < _pendingReferralRegistryEffective) {
            revert ReferralRegistryTimelockActive();
        }
        emit ReferralRegistryUpdated(referralRegistry, _registry);
        referralRegistry = _registry;
        delete _pendingReferralRegistry;
        delete _pendingReferralRegistryEffective;
    }

    /// @notice Read-only view of the staged referral-registry rotation, if any.
    function pendingReferralRegistry() external view returns (address pending, uint256 effective) {
        return (_pendingReferralRegistry, _pendingReferralRegistryEffective);
    }

    /// @notice Optional modules for session hours, dividend accrual, and allow-list compliance.
    /// @param _calendar Market calendar (zero to disable).
    /// @param _dividendManager Dividend module (zero to disable).
    /// @param _complianceManager Compliance hook (zero to disable).
    /// @dev First-time configuration (when `_rwaContractsInitialized`
    ///      is false) is allowed immediately so deploy scripts can
    ///      finish in one transaction. Any subsequent rotation requires
    ///      a 48h staged proposal via `proposeRWAContracts`. The
    ///      `_rwaContractsInitialized` latch is monotonic — once set, an
    ///      upgrade cannot clear it without a separate timelocked
    ///      implementation swap, which itself goes through
    ///      `proposeImplementation` + 48h. Off-chain monitoring should
    ///      alert on any second `RWAContractsApplied` event that does not
    ///      correspond to a prior `RWAContractsProposed`.
    function setRWAContracts(
        address _calendar,
        address _dividendManager,
        address _complianceManager
    ) external onlyAdmin {
        if (!_rwaContractsInitialized) {
            // initial wire-up: set immediately, no timelock required.
            marketCalendar = IMarketCalendar(_calendar);
            dividendManager = IDividendManager(_dividendManager);
            complianceManager = IComplianceManager(_complianceManager);
            _rwaContractsInitialized = true;
            emit RWAContractsApplied(_calendar, _dividendManager, _complianceManager);
            return;
        }
        // Subsequent rotations: enforce timelock and exact-match against staged proposal.
        if (
            _calendar != _pendingRWACalendar ||
            _dividendManager != _pendingRWADividendManager ||
            _complianceManager != _pendingRWACompliance
        ) revert PendingRWAMismatch();
        if (_pendingRWAEffective == 0 || block.timestamp < _pendingRWAEffective) revert RWATimelockActive();

        marketCalendar = IMarketCalendar(_calendar);
        dividendManager = IDividendManager(_dividendManager);
        complianceManager = IComplianceManager(_complianceManager);

        delete _pendingRWACalendar;
        delete _pendingRWADividendManager;
        delete _pendingRWACompliance;
        delete _pendingRWAEffective;

        emit RWAContractsApplied(_calendar, _dividendManager, _complianceManager);
    }

    /// @notice Stage an RWA-contract rotation. Takes effect 48h later via `setRWAContracts`.
    /// @dev The triple is staged in storage; subsequent calls overwrite.
    function proposeRWAContracts(
        address _calendar,
        address _dividendManager,
        address _complianceManager
    ) external onlyAdmin {
        _pendingRWACalendar = _calendar;
        _pendingRWADividendManager = _dividendManager;
        _pendingRWACompliance = _complianceManager;
        _pendingRWAEffective = block.timestamp + RWA_TIMELOCK;
        emit RWAContractsProposed(_calendar, _dividendManager, _complianceManager, _pendingRWAEffective);
    }

    /// @notice Read the staged RWA-contract rotation, if any.
    function pendingRWAContracts()
        external
        view
        returns (address calendar, address dividendManagerAddr, address complianceManagerAddr, uint256 effective)
    {
        return (_pendingRWACalendar, _pendingRWADividendManager, _pendingRWACompliance, _pendingRWAEffective);
    }

    uint256 private constant MAX_MARKET_ID_BYTES = 32;

    error MarketIdTooLong();
    error MarketIdRebindForbidden();

    event MarketIdUpdated(address indexed market, string oldId, string newId);

    function setMarketId(address market, string memory marketId) external onlyOperator {
        if (bytes(marketId).length > MAX_MARKET_ID_BYTES) revert MarketIdTooLong();
        string memory oldId = marketIds[market];
        // Refuse rebind only when the existing id was non-empty AND
        // there is at least one open position on this market.
        if (bytes(oldId).length > 0 && _markets[market].totalLongSize + _markets[market].totalShortSize > 0) {
            revert MarketIdRebindForbidden();
        }
        marketIds[market] = marketId;
        emit MarketIdUpdated(market, oldId, marketId);
    }

    /// @notice Authorize `bot` to trade on behalf of `_trustedSender()`. Owner pays USDC collateral.
    /// @dev Emits `SubaccountUpdated`. No timelock – ownership is revocable at any time.
    ///      ERC-2771-aware: when called through a trusted forwarder the
    ///      original signer is used as the owner, not the forwarder.
    function addSubaccount(address bot) external {
        if (bot == address(0)) revert ZeroAddress();
        address owner = _trustedSender();
        if (bot == owner) revert InvalidParam(); // cannot self-delegate
        isSubaccount[owner][bot] = true;
        emit SubaccountUpdated(owner, bot, true);
    }

    /// @notice Revoke `bot`'s authority to trade on behalf of `_trustedSender()`.
    function removeSubaccount(address bot) external {
        address owner = _trustedSender();
        isSubaccount[owner][bot] = false;
        emit SubaccountUpdated(owner, bot, false);
    }

    function _checkMarketOpen(address market) internal view {
        if (!TradingLib.checkMarketOpen(market, marketCalendar, marketIds)) revert MarketClosed();
    }

    /// @notice Build a close context resolving the active referral discount/rebate
    ///         for `trader` (typically the position owner). Pass `address(0)` to
    ///         skip the registry lookup (e.g. liquidation paths).
    function _closeCtx(address trader) internal view returns (TradingLib.ClosePositionContext memory) {
        return
            TradingContextLib.buildCloseCtx(
                address(usdc),
                address(vaultCore),
                address(oracleAggregator),
                address(positionToken),
                treasury,
                address(vaultCore),
                address(collateralRegistry),
                feeConfig,
                referralRegistry,
                trader
            );
    }

    function _liqCtx() internal view returns (TradingLib.LiquidatePositionContext memory) {
        return
            TradingContextLib.buildLiqCtx(
                address(usdc),
                address(vaultCore),
                address(oracleAggregator),
                address(positionToken),
                treasury,
                address(vaultCore),
                address(this),
                address(collateralRegistry),
                liquidationTiers,
                liquidationDeviationBps
            );
    }

    function _collateralCtx() internal view returns (TradingLib.CollateralContext memory) {
        return TradingContextLib.buildCollateralCtx(address(usdc), address(oracleAggregator), address(collateralRegistry), address(0), maxOracleUncertainty);
    }

    function _requireComplianceAndMarketOpen(address market) internal view {
        if (address(complianceManager) != address(0) && !complianceManager.isAllowed(msg.sender, market, ""))
            revert ComplianceCheckFailed();
        _checkMarketOpen(market);
    }

    /// @notice List a new active market with risk parameters and oracle feed metadata.
    function setMarket(
        address m,
        address feed,
        uint256 maxLev,
        uint256 maxPos,
        uint256 maxExp,
        uint256 mmBps,
        uint256 imBps,
        uint256 maxStaleness
    ) external onlyOperator {
        ConfigLib.setMarket(
            m,
            feed,
            maxLev,
            maxPos,
            maxExp,
            mmBps,
            imBps,
            maxStaleness,
            maxOracleUncertainty,
            _markets,
            _isMarketActive,
            _activeMarkets,
            MAX_ACTIVE_MARKETS,
            _fundingStates
        );
    }

    /// @notice Update parameters for an already-listed market.
    function updateMarket(
        address m,
        address feed,
        uint256 maxLev,
        uint256 maxPos,
        uint256 maxExp,
        uint256 mmBps,
        uint256 imBps,
        uint256 maxStaleness
    ) external onlyOperator {
        ConfigLib.updateMarket(
            m,
            feed,
            maxLev,
            maxPos,
            maxExp,
            mmBps,
            imBps,
            maxStaleness,
            maxOracleUncertainty,
            _markets
        );
    }

    /// @notice Remove a market from the active tradable set.
    function unlistMarket(address m) external onlyOperator {
        ConfigLib.unlistMarket(m, _markets, _isMarketActive, _activeMarkets);
    }

    /// @notice Replace trading/liquidation fee configuration after validation.
    function setFeeConfig(DataTypes.FeeConfig calldata _config) external onlyAdmin {
        if (!FeeCalculator.validateFeeConfig(_config)) revert FeeCalculator.InvalidFeeConfig();
        feeConfig = _config;
        emit FeeConfigUpdated(_config);
    }

    /// @notice Batch-update anti-abuse and sizing limits; pass `0` to skip a field (except `minPositionDuration` bounds).
    function setLimits(
        uint256 _uvl,
        uint256 _gvl,
        uint256 _lat,
        uint256 _lai,
        uint256 _mue,
        uint256 _mpd
    ) external onlyAdmin {
        // rather than against the in-storage value. This prevents the previous
        // ordering trap where lowering `_gvl` while `_uvl` remained at the old
        // (higher) value would revert and force a multi-step admin dance.
        uint256 newUvl = _uvl > 0 ? _uvl : userDailyVolumeLimit;
        uint256 newGvl = _gvl > 0 ? _gvl : globalDailyVolumeLimit;
        if (_uvl > 0) {
            if (_uvl < 1_000e6 || _uvl > 1_000_000_000e6) revert TradingLib.InvalidOrder();
        }
        if (_gvl > 0) {
            if (newGvl < newUvl) revert TradingLib.InvalidOrder();
        }
        if (_uvl > 0) userDailyVolumeLimit = _uvl;
        if (_gvl > 0) globalDailyVolumeLimit = _gvl;
        if (_lat > 0) {
            // Bound large-action threshold to prevent admin-induced
            // throughput DoS (zero or trivially small thresholds make
            // every action "large", coupling user throughput to
            // `largeActionInterval`). Same range as `_uvl`.
            if (_lat < 1_000e6 || _lat > 1_000_000_000e6) revert TradingLib.InvalidOrder();
            largeActionThreshold = _lat;
        }
        if (_lai > 0) {
            if (_lai > 24 hours) revert TradingLib.InvalidOrder();
            largeActionInterval = _lai;
        }
        if (_mue > 0) maxUserExposure = _mue;
        if (_mpd >= 30 && _mpd <= 3600) minPositionDuration = _mpd;
    }

    /// @notice Allow or disallow an ERC2771-style trusted forwarder for `msg.sender` resolution.
    /// @dev Emits `TrustedForwarderUpdated` for off-chain monitoring.
    function setTrustedForwarder(address forwarder, bool trusted) external onlyAdmin {
        if (forwarder == address(0)) revert ZeroAddress();
        trustedForwarders[forwarder] = trusted;
        emit TrustedForwarderUpdated(forwarder, trusted);
    }

    /// @inheritdoc ITradingCore
    function closePosition(
        DataTypes.ClosePositionParams calldata p
    ) external nonReentrant whenNotPaused noFlashLoan returns (int256) {
        _requireDeadline(p.deadline);
        DataTypes.Position storage pos = _positions[p.positionId];
        _requireComplianceAndMarketOpen(pos.market);
        settlePositionFunding(p.positionId);
        return
            TradingLib.closePositionWrapper(
                p,
                _closeCtx(positionToken.ownerOf(p.positionId)),
                minPositionDuration,
                msg.sender,
                _positions,
                _positionCollateral,
                _markets,
                _userExposure,
                protocolHealth
            );
    }

    /// @inheritdoc ITradingCore
    function partialClose(
        uint256 id,
        uint256 pct,
        uint256 minRcv,
        uint256 dl
    ) external nonReentrant whenNotPaused noFlashLoan returns (int256) {
        _requireDeadline(dl);
        DataTypes.Position storage pos = _positions[id];
        _requireComplianceAndMarketOpen(pos.market);
        settlePositionFunding(id);
        // Bound percent to PRECISION (100%) to avoid underflow on rem and unbounded close size.
        if (pct > PRECISION) pct = PRECISION;
        uint256 sz = (uint256(pos.size) * pct) / PRECISION;
        uint256 rem = uint256(pos.size) - sz;
        if (rem > 0 && rem < DataTypes.toInternalPrecision(minPositionSize)) revert PositionTooSmall();
        return
            TradingLib.closePositionWrapper(
                DataTypes.ClosePositionParams(id, sz, minRcv, dl),
                _closeCtx(positionToken.ownerOf(id)),
                minPositionDuration,
                msg.sender,
                _positions,
                _positionCollateral,
                _markets,
                _userExposure,
                protocolHealth
            );
    }

    /// @inheritdoc ITradingCore
    function recordFailedRepayment(
        uint256 positionId,
        uint256 amount,
        address market,
        bool isLong,
        int256 pnl
    ) external onlyRole(TRADING_CORE_ROLE) {
        TradingLib.recordFailedRepayment(
            positionId,
            amount,
            market,
            isLong,
            pnl,
            _failedRepayments,
            _failedRepaymentIds,
            _failedRepaymentIndex
        );
        totalFailedRepayments++;
        protocolHealth.totalBadDebt += DataTypes.toInternalPrecision(amount);
    }

    /// @inheritdoc ITradingCore
    function liquidatePosition(uint256 id) external nonReentrant whenNotPaused onlyLiquidator returns (uint256 reward) {
        // liquidations must respect market session hours; OracleAggregator widens
        // staleness to 4 days when the market is closed, so a stale-price liquidation could
        // otherwise be forced over weekends/holidays.
        DataTypes.Position storage liqPos = _positions[id];
        // Removed the previous guardian-bypass that allowed liquidating
        // closed-session markets. Combined with manual-price overrides this
        // enabled mass one-sided liquidations during halts. Closed markets
        // must wait for re-open or for an explicit `resolveFailedRepayment`
        // wind-down path. Liquidator must be active session.
        _checkMarketOpen(liqPos.market);
        // Refuse to liquidate while a manual emergency-price override is
        // active. Manual prices set by guardians (even legitimate ones)
        // can be 5% off Pyth and have zero confidence band, so they
        // are unsafe to drive liquidation outcomes.
        if (oracleAggregator.isManualPriceActive(liqPos.market)) revert BreakerActive();
        settlePositionFunding(id);
        reward = TradingLib.liquidatePosition(
            id,
            _liqCtx(),
            _positions,
            _positionCollateral,
            _markets,
            _userExposure,
            protocolHealth
        );
    }

    /// @notice Guardian/admin path to clear a recorded failed repayment after backstop resolution.
    function resolveFailedRepayment(uint256 positionId) external nonReentrant onlyAdmin {
        totalFailedRepayments = TradingLib.resolveFailedRepaymentFull(
            positionId,
            msg.sender,
            address(this),
            usdc,
            vaultCore,
            _failedRepayments,
            _failedRepaymentIds,
            _failedRepaymentIndex,
            protocolHealth,
            totalFailedRepayments
        );
    }

    /// @notice Snapshot of failed repayment bookkeeping for a position (if any).
    function getFailedRepayment(uint256 positionId) external view returns (DataTypes.FailedRepayment memory) {
        return _failedRepayments[positionId];
    }

    /// @notice Number of entries in the failed-repayment id list.
    function failedRepaymentCount() external view returns (uint256) {
        return _failedRepaymentIds.length;
    }

    /// @notice Failed-repayment position id at list `index` (unordered; for iteration only).
    function failedRepaymentIdAt(uint256 index) external view returns (uint256) {
        return _failedRepaymentIds[index];
    }

    /// @notice Pending fee/refund balances credited to `addr` from keeper execution and order cancellations.
    function getBalances(
        address addr
    ) external view returns (uint256 keeperFee, uint256 orderRefund, uint256 orderCollateralRefund) {
        return (_keeperFeeBalance[addr], _orderRefundBalance[addr], _orderCollateralRefundBalance[addr]);
    }

    /// @inheritdoc ITradingCore
    function updatePositionOwner(uint256 id, address newOwner, address oldOwner) external nonReentrant {
        if (msg.sender != address(positionToken)) revert NotPositionToken();
        if (address(complianceManager) != address(0)) {
            DataTypes.Position storage p = _positions[id];
            if (!complianceManager.isAllowed(newOwner, p.market, "")) revert ComplianceCheckFailed();
        }
        TradingLib.updatePositionOwner(id, newOwner, oldOwner, maxUserExposure, _positions, _userExposure, _userPositions);
        // owner. On NFT transfer they must be cleared so the new owner does
        // not inherit a poison trigger from the previous holder.
        DataTypes.Position storage pos = _positions[id];
        pos.stopLossPrice = 0;
        pos.takeProfitPrice = 0;
        pos.trailingStopBps = 0;
        delete _trailingAnchorPrice[id];
    }

    /// @inheritdoc ITradingCore
    function setStopLoss(uint256 id, uint256 sl) external nonReentrant whenNotPaused {
        PositionTriggersLib.setStopLoss(
            id,
            sl,
            address(positionToken),
            address(oracleAggregator),
            maxOracleUncertainty,
            _positions
        );
    }

    /// @inheritdoc ITradingCore
    function setTakeProfit(uint256 id, uint256 tp) external nonReentrant whenNotPaused {
        PositionTriggersLib.setTakeProfit(
            id,
            tp,
            address(positionToken),
            address(oracleAggregator),
            maxOracleUncertainty,
            _positions
        );
    }

    /// @inheritdoc ITradingCore
    function setTrailingStop(uint256 id, uint256 bps) external nonReentrant whenNotPaused {
        PositionTriggersLib.setTrailingStop(id, bps, MAX_TRAILING_BPS, address(positionToken), _positions);
        if (bps == 0) {
            delete _trailingAnchorPrice[id];
        } else {
            DataTypes.Position storage p = _positions[id];
            (uint256 price, , ) = oracleAggregator.getPrice(p.market);
            _trailingAnchorPrice[id] = price;
        }
    }

    /// @inheritdoc ITradingCore
    function addCollateral(uint256 id, uint256 amt, uint256 maxLev, bool emg) external nonReentrant whenNotPaused {
        _validateOwner(id);
        // Defense in depth: refuse alt-collateral tops-ups while the alt
        // path is disabled. Pre-existing alt positions (if any from a prior
        // deployment) cannot grow their alt balance and must be migrated.
        if (_positions[id].collateralToken != address(0)) revert AltCollateralDisabled();
        // cannot front-run a pending funding settlement to extract value.
        settlePositionFunding(id);
        TradingLib.addCollateral(id, amt, maxLev, emg, _collateralCtx(), _positions, _positionCollateral, _markets);
    }

    /// @inheritdoc ITradingCore
    function withdrawCollateral(uint256 id, uint256 amt) external nonReentrant whenNotPaused checkProtocolHealth {
        _validateOwner(id);
        settlePositionFunding(id);
        TradingLib.withdrawCollateral(id, amt, _collateralCtx(), _positions, _positionCollateral, _markets);
        _enforcePortfolioRiskFor(msg.sender);
    }

    /// @inheritdoc ITradingCore
    function createOrder(DataTypes.CreateOrderParams calldata params)
        external
        payable
        nonReentrant
        whenNotPaused
        noFlashLoan
        checkCompliance(params.market)
        returns (uint256 orderId)
    {
        return _createOrderCore(params);
    }

    /// @dev Shared order-creation core. `params` is `memory` so both the
    ///      struct-based and legacy positional entry points can feed it.
    ///      Compliance and anti-flash-loan gating are applied by the public
    ///      wrappers' modifiers before this runs.
    function _createOrderCore(DataTypes.CreateOrderParams memory params) internal returns (uint256 orderId) {
        // ─── Alt-collateral path is intentionally disabled. ───
        // Both `collateralType` and `collateralToken` MUST be the canonical
        // USDC values. Mixing alt collateral with the open/close/liquidate
        // fee accounting (which always ships USDC) currently traps trader
        // funds; reject at the entry point until properly redesigned.
        if (params.collateralToken != address(0)) revert AltCollateralDisabled();
        if (params.collateralType != DataTypes.CollateralType.NONE &&
            params.collateralType != DataTypes.CollateralType.USDC) {
            revert AltCollateralDisabled();
        }

        // --- Resolve subaccount delegation ---
        address effectiveOwner = _resolveSubaccountOwner(params.owner);

        bool openingIncrease = (params.orderType == DataTypes.OrderType.MARKET_INCREASE ||
            params.orderType == DataTypes.OrderType.LIMIT_INCREASE);

        // `effectiveOwner` (passed below as `msgSender`). The wrapper must NOT
        // pre-pull or the user is debited twice (and may revert / strand funds).
        // the bot. The base `checkCompliance` modifier validates `msg.sender`.
        if (effectiveOwner != msg.sender && address(complianceManager) != address(0)) {
            if (!complianceManager.isAllowed(effectiveOwner, params.market, "")) revert ComplianceCheckFailed();
        }

        // --- Post-Only validation ---
        if (params.tif == DataTypes.TimeInForce.POST_ONLY) {
            if (params.orderType == DataTypes.OrderType.MARKET_INCREASE ||
                params.orderType == DataTypes.OrderType.MARKET_DECREASE) {
                revert PostOnlyNotAllowedForMarket();
            }
            // Fetch spot price and check if the limit order would cross the spread immediately
            (uint256 spotPrice, uint256 confidence, ) = oracleAggregator.getPrice(params.market);
            if (spotPrice == 0 || confidence > maxOracleUncertainty / 2) revert InvalidOraclePrice();

            if (params.isLong) {
                // Long order: if limit is above spot it would execute immediately -> post-only must rest below spot
                if (params.triggerPrice >= spotPrice) revert PostOnlyCrossesBook();
            } else {
                // Short order: if limit is below spot it would execute immediately -> post-only must rest above spot
                if (params.triggerPrice <= spotPrice) revert PostOnlyCrossesBook();
            }
        }

        // --- Reduce-only validation ---
        if (params.isReduceOnly && params.positionId == 0) {
            revert ReduceOnlyRequiresPosition();
        }

        // --- Visible size validation ---
        if (params.visibleSize > 0 && params.visibleSize > params.sizeDelta) {
            revert InvalidVisibleSize();
        }
        // not implemented in the executor. Reject any order that requests
        // them rather than silently drop the directive at execution time.
        if (params.visibleSize > 0 && params.visibleSize < params.sizeDelta) {
            revert InvalidVisibleSize();
        }
        // IOC/FOK are not enforced by the executor (they would silently behave
        // as GTC). Reject them explicitly so users are never misled. POST_ONLY
        // (validated above) and GTC are the supported directives.
        if (params.tif == DataTypes.TimeInForce.IOC || params.tif == DataTypes.TimeInForce.FOK) {
            revert UnsupportedTimeInForce();
        }
        if (params.isReduceOnly) {
            if (params.orderType == DataTypes.OrderType.MARKET_INCREASE ||
                params.orderType == DataTypes.OrderType.LIMIT_INCREASE) {
                revert ReduceOnlyRequiresPosition();
            }
        }

        // --- Rate-limit gate for opening/increase orders ---
        if (openingIncrease) {
            // gate: large position rate-limit is enforced at executeOrder fill time
            // Check the market is currently open for trading
        }

        _checkMarketOpen(params.market);
        orderId = TradingLib.createOrder(
            _nextOrderId++,
            params,
            msg.value,
            effectiveOwner,   // order is credited to the owner, not the bot
            minExecutionFee,
            address(oracleAggregator),
            address(usdc),
            _orders
        );
        // Track the actual payer of the execution fee. For non-delegated
        // orders this equals `effectiveOwner == msg.sender`. For
        // subaccount-delegated orders the bot pays `msg.value` but the
        // order is owned by `effectiveOwner`; we record the bot here so
        // the cancel-side refund flows back to whoever actually paid.
        if (msg.value > 0) {
            _orderExecutionFeePayer[orderId] = msg.sender;
        }
        emit OrderCreated(orderId, effectiveOwner, params.orderType, params.market);
    }

    /// @notice Legacy 8-arg `createOrder` shim that bundles its arguments into
    ///         the canonical `CreateOrderParams` struct and forwards to the
    ///         struct-based entry point. Preserved for backwards compatibility
    ///         with off-chain integrations and existing test suites that
    ///         predate the bundled-params refactor.
    function createOrder(
        DataTypes.OrderType orderType,
        address market,
        uint256 sizeDelta,
        uint256 collateralDelta,
        uint256 triggerPrice,
        bool isLong,
        uint256 maxSlippage,
        uint256 positionId
    )
        external
        payable
        nonReentrant
        whenNotPaused
        noFlashLoan
        checkCompliance(market)
        returns (uint256)
    {
        DataTypes.CreateOrderParams memory params = DataTypes.CreateOrderParams({
            orderType: orderType,
            market: market,
            sizeDelta: sizeDelta,
            collateralDelta: collateralDelta,
            triggerPrice: triggerPrice,
            isLong: isLong,
            maxSlippage: maxSlippage,
            positionId: positionId,
            collateralType: DataTypes.CollateralType.NONE,
            collateralToken: address(0),
            tif: DataTypes.TimeInForce.GTC,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            visibleSize: 0,
            twapInterval: 0,
            isReduceOnly: false,
            owner: address(0)
        });
        return _createOrderCore(params);
    }

    /// @inheritdoc ITradingCore
    function executeOrder(
        uint256 orderId,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant whenNotPaused onlyRole(KEEPER_ROLE) checkBreakersForOrder(orderId) {
        TradingLib.applyPythUpdateAndRefund(address(oracleAggregator), priceUpdateData, msg.value, msg.sender);
        DataTypes.Order storage order = _orders[orderId];
        if (order.account != address(0)) {
            bool openingIncrease = (order.orderType == DataTypes.OrderType.MARKET_INCREASE ||
                order.orderType == DataTypes.OrderType.LIMIT_INCREASE);
            if (openingIncrease && !protocolHealth.isHealthy) revert ProtocolUnhealthy();
            if (openingIncrease && _userPositions[order.account].length >= maxPositionsPerUser) {
                revert TradingLib.MaxPositionsExceeded();
            }
            // Enforce the large-action rate-limit ONCE, here at fill
            //             time, against the *order owner* (not msg.sender, who
            //             is the keeper). This replaces the previous double-
            //             charge between `gateNewIncreaseOrder` and the inline
            //             check below.
            if (openingIncrease && largeActionThreshold > 0) {
                RateLimitLib.checkAndUpdateFor(
                    order.account,
                    order.sizeDelta, // USDC precision; threshold is also USDC precision
                    largeActionThreshold,
                    largeActionInterval,
                    block.timestamp,
                    _lastLargeActionTime
                );
            }
        }
        if (
            order.positionId > 0 &&
            (order.orderType == DataTypes.OrderType.MARKET_DECREASE ||
                order.orderType == DataTypes.OrderType.LIMIT_DECREASE)
        ) {
            settlePositionFunding(order.positionId);
        }
        (uint256 positionId, uint256 orderIdOut, uint256 executionFee, bool isIncrease) = TradingLib.executeOrderFull(
            orderId,
            address(oracleAggregator),
            TradingLib.OrderRiskParams({
                maxOracleUncertainty: maxOracleUncertainty,
                minPositionSize: minPositionSize,
                maxUserExposure: maxUserExposure,
                userDailyVolumeLimit: userDailyVolumeLimit,
                globalDailyVolumeLimit: globalDailyVolumeLimit,
                defaultCrossMargin: crossMarginByDefault,
                collateralRegistry: address(collateralRegistry),
                collateralToken: order.collateralToken,
                referralRegistry: referralRegistry
            }),
            address(usdc),
            address(vaultCore),
            address(positionToken),
            treasury,
            feeConfig,
            _orders,
            _positions,
            _positionCollateral,
            _markets,
            _userPositions,
            _userExposure,
            nextPositionId,
            dividendManager,
            marketIds,
            positionDividendIndex,
            _userDailyVolume,
            _globalDailyVolume,
            protocolHealth
        );
        if (isIncrease) {
            // Seed the per-position cumulative-funding pointer to the
            // market's current cumulative funding BEFORE any subsequent
            // settlement runs. Without this, fresh positions are charged or
            // credited the entire historical accumulation on first settle.
            // Defense-in-depth: also done explicitly here in case a future
            // library change skips it.
            _positionCumulativeFunding[positionId] = _fundingStates[order.market].cumulativeFunding;
            _enforcePortfolioRiskFor(order.account);
            nextPositionId++;
        }
        if (executionFee > 0) _keeperFeeBalance[msg.sender] += executionFee;
        delete _orders[orderIdOut];
        // Clean up the per-order execution-fee-payer tracking. The
        // execution fee was already paid out to the keeper above; no
        // refund is owed.
        delete _orderExecutionFeePayer[orderIdOut];
        emit OrderExecuted(orderId, positionId, msg.sender);
    }

    /// @notice Pull accumulated keeper execution fees to `msg.sender`.
    function withdrawKeeperFees() external nonReentrant {
        WithdrawLib.withdrawKeeperFees(_keeperFeeBalance, msg.sender);
    }

    /// @inheritdoc ITradingCore
    function cancelOrder(uint256 orderId) external nonReentrant whenNotPaused {
        // Snapshot the recorded fee payer before the library deletes the
        // order. For direct orders this is `msg.sender`; for subaccount
        // delegations this is the bot that fronted `msg.value` on create.
        address feePayer = _orderExecutionFeePayer[orderId];
        delete _orderExecutionFeePayer[orderId];
        TradingLib.cancelOrder(
            orderId,
            msg.sender,
            feePayer,
            usdc,
            _orders,
            _orderRefundBalance,
            _orderCollateralRefundBalance,
            _orderCollateralTokenRefundBalance
        );
    }

    /// @notice Withdraw USDC escrow returned from a cancelled order collateral leg.
    function withdrawOrderCollateralRefund() external nonReentrant {
        WithdrawLib.withdrawOrderCollateralRefund(_orderCollateralRefundBalance, msg.sender, usdc);
    }

    function withdrawOrderCollateralTokenRefund(address token) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        WithdrawLib.withdrawOrderCollateralTokenRefund(
            _orderCollateralTokenRefundBalance,
            msg.sender,
            token
        );
    }

    /// @notice Withdraw native ETH refunds from cancelled orders (when applicable).
    function withdrawOrderRefund() external nonReentrant {
        WithdrawLib.withdrawOrderRefund(_orderRefundBalance, msg.sender);
    }

    /// @inheritdoc ITradingCore
    function settleFunding(address market) external whenNotPaused {
        FundingLib.settleFunding(_fundingStates[market], _markets[market], market);
    }

    /// @inheritdoc ITradingCore
    function settlePositionFunding(uint256 id) public returns (int256 paid) {
        return
            TradingLib.settlePositionFundingWithDividends(
                id,
                address(oracleAggregator),
                _positions,
                _positionCollateral,
                _fundingStates,
                _positionCumulativeFunding,
                dividendManager,
                marketIds,
                positionDividendIndex
            );
    }

    /// @notice Set the delegate views contract powering `getPositionPnL`, `canLiquidate`, and `getGlobalUnrealizedPnL`.
    function setTradingViews(address _v) external onlyAdmin {
        tradingViews = _v;
        emit TradingViewsUpdated(_v);
    }

    /// @notice Configure account-level portfolio risk controls for cross-margin.
    function setPortfolioRiskConfig(
        bool enabled,
        bool defaultCrossMargin,
        uint16 maintenanceMarginBps,
        uint16 concentrationLimitBps,
        uint8 maxCrossPositions
    ) external onlyAdmin {
        if (maintenanceMarginBps > 5000 || concentrationLimitBps > 10000) revert InvalidParam();
        portfolioRiskConfig = DataTypes.PortfolioRiskConfig({
            maintenanceMarginBps: maintenanceMarginBps,
            concentrationLimitBps: concentrationLimitBps,
            maxCrossPositions: maxCrossPositions,
            enabled: enabled
        });
        crossMarginByDefault = defaultCrossMargin;
    }

    /// @notice Collateral row for a position (USDC amount and token address metadata).
    function getPositionCollateral(uint256 id) external view returns (uint256 amount, address tokenAddress) {
        DataTypes.PositionCollateral storage c = _positionCollateral[id];
        return (c.amount, c.tokenAddress);
    }

    /// @notice Number of markets currently in the active list.
    function activeMarketCount() external view returns (uint256) {
        return _activeMarkets.length;
    }

    /// @notice Market contract address at `index` in the active list (unordered stable index until mutation).
    function activeMarketAt(uint256 index) external view returns (address) {
        return _activeMarkets[index];
    }

    /// @inheritdoc ITradingCore
    function getPosition(uint256 id) external view returns (DataTypes.Position memory) {
        return _positions[id];
    }

    /// @inheritdoc ITradingCore
    function getPositionPnL(uint256 id) external view returns (int256 pnl, uint256 hf) {
        address v = tradingViews;
        if (v == address(0)) revert Unauthorized();
        return ITradingCoreViewsQueries(v).getPositionPnL(this, id);
    }

    /// @inheritdoc ITradingCore
    function getUserPositions(address u) external view returns (uint256[] memory) {
        return _userPositions[u];
    }

    /// @inheritdoc ITradingCore
    function getMarketInfo(address c) external view returns (DataTypes.Market memory) {
        return _markets[c];
    }

    /// @inheritdoc ITradingCore
    function getFundingState(address c) external view returns (DataTypes.FundingState memory) {
        return _fundingStates[c];
    }

    /// @inheritdoc ITradingCore
    function canLiquidate(uint256 id) external view returns (bool, uint256 hf) {
        address v = tradingViews;
        if (v == address(0)) revert Unauthorized();
        return ITradingCoreViewsQueries(v).canLiquidate(this, id);
    }

    /// @notice Remove stale closed-position ids from `u`'s enumeration (self-serve or admin with higher cap).
    /// @dev Refuses to clean a position that still has an unresolved
    ///      failed-repayment record so off-chain bookkeeping and
    ///      `resolveFailedRepayment` stay consistent. Admin path is
    ///      restricted to `CLOSED` state only — `LIQUIDATED` records are
    ///      preserved as audit trail.
    function cleanupPositions(address u, uint256 maxClean) external returns (uint256) {
        if (u != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        uint256 cap = hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ? 40 : MAX_CLEANUP;
        uint256 limit = maxClean > cap ? cap : maxClean;
        return CleanupLib.cleanupPositions(
            _userPositions[u],
            _positions,
            _positionCollateral,
            limit,
            _failedRepayments,
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
        );
    }

    /// @notice Batch-update execution/oracle/liquidation tuning; `0` skips a field where documented.
    function setParams(
        uint256 mps,
        uint256 mou,
        uint256 mab,
        uint256 mef,
        uint256 mpp,
        uint256 mid,
        uint256 ldb
    ) external onlyAdmin {
        // bounded ranges.
        if (mps > 0) minPositionSize = mps;
        if (mou > 0) {
            if (mou > 1e18) revert TradingLib.InvalidOrder(); // confidence is a fraction up to 100%.
            maxOracleUncertainty = mou;
        }
        if (mab > 0) {
            if (mab > 1000) revert TradingLib.InvalidOrder();
            maxActionsPerBlock = mab;
        }
        if (mef > 0) minExecutionFee = mef;
        if (mpp > 0) {
            if (mpp > 500) revert TradingLib.InvalidOrder();
            maxPositionsPerUser = mpp;
        }
        if (mid > 0) {
            if (mid > 1 hours) revert TradingLib.InvalidOrder();
            minInteractionDelay = mid;
        }
        if (ldb >= 100 && ldb <= 5000) liquidationDeviationBps = ldb;
    }

    /// @notice Send sub-threshold dust balances to `treasury` per `DustLib` rules.
    function sweepDust() external onlyAdmin {
        DustLib.sweepDust(usdc, treasury, dustAccumulator);
    }

    /// @notice Configurable funding-interval cap, bounded sanely.
    /// @param cap New cap, in 8-hour intervals. Bounded `[1, 72]` ≈ 24 days.
    /// @dev Tightened from `MAX_FUNDING_INTERVALS * 10` (240 / 80 days) to
    ///      72 (24 days). Combined with the new non-truncating settlement
    ///      in `FundingLib`, this bounds the maximum funding shock applied
    ///      in a single `forceSettleFunding` call. Markets dormant longer
    ///      than the cap require multiple `forceSettleFunding` calls.
    function setMaxFundingIntervals(uint256 cap) external onlyAdmin {
        if (cap == 0 || cap > 72) revert InvalidParam();
        maxFundingIntervals = cap;
    }

    /// @notice Configurable absolute liquidator-reward floor (USDC).
    /// @dev When a liquidation pays less than this, `LiquidatorRewardCapped` is
    ///      emitted but the liquidation still proceeds; this is informational only.
    function setMinLiquidatorRewardUsdc(uint256 floorUsdc) external onlyAdmin {
        // Bounded `[0, 1000e6]` USDC. Zero disables the warning event.
        if (floorUsdc > 1000e6) revert InvalidParam();
        minLiquidatorRewardUsdc = floorUsdc;
        emit LiquidatorRewardFloorUpdated(2500, floorUsdc); // BPS floor unchanged in code today
    }

    /// @notice Force-settle funding for a market using the admin-tunable interval cap.
    /// @dev Lets a guardian catch up a long-dormant market without an upgrade.
    function forceSettleFunding(address market) external onlyGuardian whenNotPaused {
        FundingLib.settleFundingWithCap(_fundingStates[market], _markets[market], market, maxFundingIntervals);
    }

    /// @notice Keeper hook to refresh `protocolHealth` from current vault TVL (: nets insurance).
    function updateProtocolHealth() external onlyRole(KEEPER_ROLE) {
        HealthLib.updateProtocolHealthWithInsurance(
            vaultCore.totalAssets(),
            vaultCore.insuranceAssets(),
            protocolHealth
        );
    }

    /// @inheritdoc ITradingCore
    function getGlobalUnrealizedPnL() external view returns (int256 totalPnL) {
        address v = tradingViews;
        if (v == address(0)) revert Unauthorized();
        return ITradingCoreViewsQueries(v).getGlobalUnrealizedPnL(this);
    }

    /// @notice Resolve the effective owner for subaccount delegation.
    ///         If `params.owner` is zero or equals `msg.sender`, returns `msg.sender` (direct order).
    ///         Otherwise verifies `isSubaccount[owner][msg.sender]` and returns `owner`.
    /// @dev Reverts with `SubaccountNotApproved` when delegation is not authorized.
    function _resolveSubaccountOwner(address owner) internal view returns (address) {
        if (owner == address(0) || owner == msg.sender) return msg.sender;
        if (!isSubaccount[owner][msg.sender]) revert SubaccountNotApproved();
        return owner;
    }

    function _validateOwner(uint256 id) internal view returns (DataTypes.Position storage p) {
        p = _positions[id];
        if (p.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();
        if (positionToken.ownerOf(id) != msg.sender) revert NotPositionOwner();
    }

    function _enforcePortfolioRiskFor(address account) internal view {
        if (!portfolioRiskConfig.enabled || address(oracleAggregator) == address(0)) return;
        DataTypes.AccountRiskSnapshot memory snapshot = PortfolioRiskLib.getAccountRisk(
            account,
            address(oracleAggregator),
            portfolioRiskConfig,
            _userPositions,
            _positions,
            _positionCollateral
        );
        if (!PortfolioRiskLib.validateOpenPosition(snapshot, portfolioRiskConfig)) revert PortfolioRiskViolation();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {
        _enforceUpgradeTimelock(newImplementation);
    }

    /// @notice Keeper batch: close positions whose stop-loss / take-profit / trailing conditions are met.
    /// @return count Number of positions successfully processed (implementation-defined semantics).
    function executeStopLossTakeProfit(
        uint256[] calldata positionIds,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant whenNotPaused onlyRole(KEEPER_ROLE) returns (uint256) {
        TradingLib.applyPythUpdateAndRefund(address(oracleAggregator), priceUpdateData, msg.value, msg.sender);
        // trigger closes must use a fresh in-session price; per-position market-open
        // checks happen inside the library to allow mixed-market batches to skip closed markets
        // gracefully instead of reverting the entire batch.
        return
            TradingLib.executeStopLossTakeProfit(
                positionIds,
                _closeCtx(address(0)),
                address(oracleAggregator),
                referralRegistry,
                _positions,
                _positionCollateral,
                _markets,
                _userExposure,
                _fundingStates,
                _positionCumulativeFunding,
                positionDividendIndex,
                marketIds,
                dividendManager,
                protocolHealth,
                address(marketCalendar),
                _trailingAnchorPrice
            );
    }

    /// @notice Aggregate protocol health snapshot for dashboards.
    function getProtocolHealthState()
        external
        view
        returns (bool isHealthy, uint256 totalBadDebt, uint64 lastHealthCheck)
    {
        return (protocolHealth.isHealthy, protocolHealth.totalBadDebt, protocolHealth.lastHealthCheck);
    }

    /// @notice Cross-margin account risk snapshot.
    function getAccountRisk(address account) external view returns (DataTypes.AccountRiskSnapshot memory) {
        return
            PortfolioRiskLib.getAccountRisk(
                account,
                address(oracleAggregator),
                portfolioRiskConfig,
                _userPositions,
                _positions,
                _positionCollateral
            );
    }

    /// @notice Whether the account is currently liquidatable under cross-margin.
    function canLiquidateAccount(address account) external view returns (bool liquidatable, uint256 healthFactor) {
        DataTypes.AccountRiskSnapshot memory snapshot = PortfolioRiskLib.getAccountRisk(
            account,
            address(oracleAggregator),
            portfolioRiskConfig,
            _userPositions,
            _positions,
            _positionCollateral
        );
        return (snapshot.liquidatable, snapshot.healthFactor);
    }

    /// @notice Admin path to write down the bad-debt counter once losses are externally covered .
    /// @dev Only ever decrements; never increments. Use after insurance replenishment / surplus accrual.
    function writeDownBadDebt(uint256 amountInternalPrecision) external onlyAdmin {
        if (amountInternalPrecision >= protocolHealth.totalBadDebt) {
            protocolHealth.totalBadDebt = 0;
        } else {
            protocolHealth.totalBadDebt -= amountInternalPrecision;
        }
        protocolHealth.lastHealthCheck = uint64(block.timestamp);
    }

    /// @notice Reverts with `InsufficientOracleSources` when the oracle has no healthy configured source for `market`.
    /// @param market Market address to validate.
    function validateOracleForMarket(address market) external view requireOracleSources(market) {}
}

/**
 * @title ITradingCoreViewsQueries
 * @notice Internal query interface consumed by TradingCore for delegated view logic.
 * @dev Implemented by TradingCoreViews and called when `tradingViews` is configured.
 */
interface ITradingCoreViewsQueries {
    /// @notice Compute live PnL and health for `id` on `core` storage layout.
    function getPositionPnL(ITradingCore core, uint256 id) external view returns (int256 pnl, uint256 hf);

    /// @notice Whether `id` is liquidatable on `core` at current oracle snapshot.
    function canLiquidate(ITradingCore core, uint256 id) external view returns (bool, uint256 hf);

    /// @notice Sum of unrealized PnL across all open positions on `core`.
    function getGlobalUnrealizedPnL(ITradingCore core) external view returns (int256);
}
