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
import "../libraries/ConfigLib.sol";
import "../libraries/TradingContextLib.sol";
import "../libraries/RateLimitLib.sol";
import "../libraries/PositionTriggersLib.sol";
import "../libraries/CleanupLib.sol";

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
    error TransferToContractNotAllowed();
    error ComplianceCheckFailed();
    error MarketClosed();
    error DeviationOutOfRange();
    /// @dev Mirrored from TradingLib so callers and off-chain tooling can decode library reverts on this contract.
    error InvalidOraclePrice();
    error MinPositionDuration();
    error ExecutionFeeTooLow();

    event ParamsUpdated(string paramName, uint256 oldValue, uint256 newValue);

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

    IMarketCalendar public marketCalendar;
    IDividendManager public dividendManager;
    mapping(address => string) public marketIds;
    mapping(uint256 => uint256) public positionDividendIndex;

    IComplianceManager public complianceManager;

    address[] private _activeMarkets;
    mapping(address => bool) private _isMarketActive;

    address public tradingViews;

    uint256[24] private __gap;

    modifier noFlashLoan() {
        (_lastGlobalInteractionBlock, _globalBlockInteractions) = FlashLoanCheck.validateFlashLoan(
            msg.sender,
            tx.origin,
            block.number,
            block.timestamp,
            hasRole(OPERATOR_ROLE, msg.sender),
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

    /// @notice For new risk-increasing orders: circuit breaker, protocol health, and large-size rate limit (internal precision).
    modifier gateNewIncreaseOrder(DataTypes.OrderType orderType, address market, uint256 sizeDelta) {
        if (orderType == DataTypes.OrderType.MARKET_INCREASE || orderType == DataTypes.OrderType.LIMIT_INCREASE) {
            if (!oracleAggregator.isActionAllowed(market, 0)) revert BreakerActive();
            if (!protocolHealth.isHealthy) revert ProtocolUnhealthy();
            RateLimitLib.checkAndUpdate(
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
        if (address(complianceManager) != address(0)) {
            if (!complianceManager.isAllowed(msg.sender, market, bytes(""))) revert ComplianceCheckFailed();
        }
        _;
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
    }

    /// @notice Wire core external dependencies after deploy.
    /// @param _vc Vault used for borrow/repay and TVL health.
    /// @param _oa Oracle aggregator for prices and breakers.
    /// @param _pt ERC721 position token.
    function setContracts(address _vc, address _oa, address _pt) external onlyAdmin {
        if (_vc == address(0) || _oa == address(0) || _pt == address(0)) revert ZeroAddress();
        vaultCore = IVaultCore(_vc);
        oracleAggregator = IOracleAggregator(_oa);
        positionToken = IPositionToken(_pt);
    }

    /// @notice Optional modules for session hours, dividend accrual, and allow-list compliance.
    /// @param _calendar Market calendar (zero to disable).
    /// @param _dividendManager Dividend module (zero to disable).
    /// @param _complianceManager Compliance hook (zero to disable).
    function setRWAContracts(
        address _calendar,
        address _dividendManager,
        address _complianceManager
    ) external onlyAdmin {
        marketCalendar = IMarketCalendar(_calendar);
        dividendManager = IDividendManager(_dividendManager);
        complianceManager = IComplianceManager(_complianceManager);
    }

    /// @notice Map a market contract to a calendar `marketId` string used by `IMarketCalendar`.
    function setMarketId(address market, string memory marketId) external onlyOperator {
        marketIds[market] = marketId;
    }

    function _checkMarketOpen(address market) internal view {
        if (!TradingLib.checkMarketOpen(market, marketCalendar, marketIds)) revert MarketClosed();
    }

    function _closeCtx() internal view returns (TradingLib.ClosePositionContext memory) {
        return
            TradingContextLib.buildCloseCtx(
                address(usdc),
                address(vaultCore),
                address(oracleAggregator),
                address(positionToken),
                treasury,
                address(vaultCore),
                feeConfig
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
                liquidationTiers,
                liquidationDeviationBps
            );
    }

    function _collateralCtx() internal view returns (TradingLib.CollateralContext memory) {
        return TradingContextLib.buildCollateralCtx(address(usdc), address(oracleAggregator), maxOracleUncertainty);
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
            MAX_ACTIVE_MARKETS
        );
        emit MarketUpdated(m, maxLev, maxPos, maxExp);
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
        emit MarketUpdated(m, maxLev, maxPos, maxExp);
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
        if (_uvl > 0) userDailyVolumeLimit = _uvl;
        if (_gvl > 0) globalDailyVolumeLimit = _gvl;
        if (_lat > 0) largeActionThreshold = _lat;
        if (_lai > 0) largeActionInterval = _lai;
        if (_mue > 0) maxUserExposure = _mue;
        if (_mpd >= 30 && _mpd <= 3600) minPositionDuration = _mpd;
    }

    /// @notice Allow or disallow an ERC2771-style trusted forwarder for `msg.sender` resolution.
    function setTrustedForwarder(address forwarder, bool trusted) external onlyAdmin {
        if (forwarder == address(0)) revert ZeroAddress();
        trustedForwarders[forwarder] = trusted;
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
                _closeCtx(),
                minPositionDuration,
                msg.sender,
                _positions,
                _positionCollateral,
                _markets,
                _userExposure
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
        uint256 sz = (uint256(pos.size) * pct) / PRECISION;
        uint256 rem = uint256(pos.size) - sz;
        if (rem > 0 && rem < DataTypes.toInternalPrecision(minPositionSize)) revert PositionTooSmall();
        return
            TradingLib.closePositionWrapper(
                DataTypes.ClosePositionParams(id, sz, minRcv, dl),
                _closeCtx(),
                minPositionDuration,
                msg.sender,
                _positions,
                _positionCollateral,
                _markets,
                _userExposure
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
        settlePositionFunding(id);
        reward = TradingLib.liquidatePosition(id, _liqCtx(), _positions, _positionCollateral, _markets, _userExposure);
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
        TradingLib.updatePositionOwner(id, newOwner, oldOwner, maxUserExposure, _positions, _userExposure);
    }

    /// @inheritdoc ITradingCore
    function setStopLoss(uint256 id, uint256 sl) external nonReentrant {
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
    function setTakeProfit(uint256 id, uint256 tp) external nonReentrant {
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
    function setTrailingStop(uint256 id, uint256 bps) external nonReentrant {
        PositionTriggersLib.setTrailingStop(id, bps, MAX_TRAILING_BPS, address(positionToken), _positions);
    }

    /// @inheritdoc ITradingCore
    function addCollateral(uint256 id, uint256 amt, uint256 maxLev, bool emg) external nonReentrant {
        _validateOwner(id);
        TradingLib.addCollateral(id, amt, maxLev, emg, _collateralCtx(), _positions, _positionCollateral, _markets);
    }

    /// @inheritdoc ITradingCore
    function withdrawCollateral(uint256 id, uint256 amt) external nonReentrant checkProtocolHealth {
        _validateOwner(id);
        TradingLib.withdrawCollateral(id, amt, _collateralCtx(), _positions, _positionCollateral, _markets);
    }

    /// @inheritdoc ITradingCore
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
        gateNewIncreaseOrder(orderType, market, sizeDelta)
        returns (uint256 orderId)
    {
        _checkMarketOpen(market);
        orderId = TradingLib.createOrder(
            _nextOrderId++,
            orderType,
            market,
            sizeDelta,
            collateralDelta,
            triggerPrice,
            isLong,
            maxSlippage,
            positionId,
            msg.value,
            msg.sender,
            minExecutionFee,
            address(oracleAggregator),
            address(usdc),
            _orders
        );
        emit OrderCreated(orderId, msg.sender, orderType, market);
    }

    /// @inheritdoc ITradingCore
    function executeOrder(
        uint256 orderId,
        bytes[] calldata
    ) external nonReentrant onlyRole(KEEPER_ROLE) checkBreakersForOrder(orderId) {
        DataTypes.Order storage order = _orders[orderId];
        if (order.account != address(0)) {
            bool openingIncrease = (order.orderType == DataTypes.OrderType.MARKET_INCREASE ||
                order.orderType == DataTypes.OrderType.LIMIT_INCREASE);
            if (openingIncrease && !protocolHealth.isHealthy) revert ProtocolUnhealthy();
            if (openingIncrease && _userPositions[order.account].length >= maxPositionsPerUser) {
                revert TradingLib.MaxPositionsExceeded();
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
            maxOracleUncertainty,
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
            positionDividendIndex
        );
        if (isIncrease) nextPositionId++;
        if (executionFee > 0) _keeperFeeBalance[msg.sender] += executionFee;
        delete _orders[orderIdOut];
        emit OrderExecuted(orderId, positionId, msg.sender);
    }

    /// @notice Pull accumulated keeper execution fees to `msg.sender`.
    function withdrawKeeperFees() external nonReentrant {
        WithdrawLib.withdrawKeeperFees(_keeperFeeBalance, msg.sender);
    }

    /// @inheritdoc ITradingCore
    function cancelOrder(uint256 orderId) external nonReentrant {
        TradingLib.cancelOrder(orderId, msg.sender, usdc, _orders, _orderRefundBalance, _orderCollateralRefundBalance);
    }

    /// @notice Withdraw USDC escrow returned from a cancelled order collateral leg.
    function withdrawOrderCollateralRefund() external nonReentrant {
        WithdrawLib.withdrawOrderCollateralRefund(_orderCollateralRefundBalance, msg.sender, usdc);
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
        if (tradingViews == address(0)) revert Unauthorized();
        return ITradingCoreViewsQueries(tradingViews).getPositionPnL(this, id);
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
        if (tradingViews == address(0)) revert Unauthorized();
        return ITradingCoreViewsQueries(tradingViews).canLiquidate(this, id);
    }

    /// @notice Remove stale closed-position ids from `u`'s enumeration (self-serve or admin with higher cap).
    function cleanupPositions(address u, uint256 maxClean) external returns (uint256) {
        if (u != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        uint256 cap = hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ? 40 : MAX_CLEANUP;
        uint256 limit = maxClean > cap ? cap : maxClean;
        return CleanupLib.cleanupPositions(_userPositions[u], _positions, _positionCollateral, limit);
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
        if (mps > 0) {
            minPositionSize = mps;
        }
        if (mou > 0) {
            maxOracleUncertainty = mou;
        }
        if (mab > 0) {
            maxActionsPerBlock = mab;
        }
        if (mef > 0) {
            minExecutionFee = mef;
        }
        if (mpp > 0) {
            maxPositionsPerUser = mpp;
        }
        if (mid > 0) {
            minInteractionDelay = mid;
        }
        if (ldb >= 100 && ldb <= 5000) {
            liquidationDeviationBps = ldb;
        }
    }

    /// @notice Send sub-threshold dust balances to `treasury` per `DustLib` rules.
    function sweepDust() external onlyAdmin {
        DustLib.sweepDust(usdc, treasury, dustAccumulator);
    }

    /// @notice Keeper hook to refresh `protocolHealth` from current vault TVL.
    function updateProtocolHealth() external onlyRole(KEEPER_ROLE) {
        HealthLib.updateProtocolHealth(vaultCore.totalAssets(), protocolHealth);
    }

    /// @inheritdoc ITradingCore
    function getGlobalUnrealizedPnL() external view returns (int256 totalPnL) {
        if (tradingViews == address(0)) revert Unauthorized();
        return ITradingCoreViewsQueries(tradingViews).getGlobalUnrealizedPnL(this);
    }

    function _validateOwner(uint256 id) internal view returns (DataTypes.Position storage p) {
        p = _positions[id];
        if (p.state != DataTypes.PosStatus.OPEN) revert PositionNotFound();
        if (positionToken.ownerOf(id) != msg.sender) revert NotPositionOwner();
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {}

    /// @notice Keeper batch: close positions whose stop-loss / take-profit / trailing conditions are met.
    /// @return count Number of positions successfully processed (implementation-defined semantics).
    function executeStopLossTakeProfit(
        uint256[] calldata positionIds
    ) external nonReentrant whenNotPaused onlyRole(KEEPER_ROLE) returns (uint256) {
        return
            TradingLib.executeStopLossTakeProfit(
                positionIds,
                _closeCtx(),
                address(oracleAggregator),
                _positions,
                _positionCollateral,
                _markets,
                _userExposure,
                _fundingStates,
                _positionCumulativeFunding,
                positionDividendIndex,
                marketIds,
                dividendManager
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
