// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../base/AccessControlled.sol";
import "../libraries/DataTypes.sol";
import "../interfaces/ITradingCore.sol";

/**
 * @title VaultCore
 * @notice Unified USDC vault: LP liquidity for `TradingCore`, insurance tranche, borrow/repay hooks, withdrawal queue, and bad-debt governance.
 * @dev Mirrors `IVaultCore` surface for integrators; mutators are role- or `TradingCore`-gated as documented per function.
 */
contract VaultCore is Initializable, UUPSUpgradeable, ReentrancyGuardUpgradeable, AccessControlled {
    using SafeERC20 for IERC20;

    error InsufficientShares();
    error InsufficientLiquidity();
    error ExceedsExposureCap();
    error UtilizationTooHigh();
    error EmergencyModeActive();
    error WithdrawalNotReady();
    error InvalidRequest();
    error MinimumDepositRequired();
    error ZeroShares();
    error ZeroAssets();
    error NotOwner();
    error UnhealthyRatio();
    error CooldownNotComplete();
    error CooldownNotStarted();
    error ClaimNotApproved();
    error InvalidTVL();
    error ClaimRateLimitExceeded();
    error InsuranceFundCircuitBreakerActive();
    error CollectionExposureLimitExceeded();
    error InsufficientRepayBalance();
    error InvalidFirstDeposit();
    error ClaimInvalidOrPaid();
    error NotEmergencyMode();
    error EscapeTimelockNotExpired();
    error PendingTreasuryMismatch();
    error TreasuryTimelockActive();
    error MinimumInsuranceDepositRequired();
    error SlippageExceeded();
    /// @dev 48h timelock surface for `setTradingCore`.
    error PendingTradingCoreMismatch();
    error TradingCoreTimelockActive();

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant SHARE_DECIMALS = 18;
    uint256 private constant USDC_DECIMALS = 6;
    uint256 private constant DEAD_SHARES = 1e18;
    uint256 private constant MAX_WITHDRAWAL_BATCH = 50;
    uint256 private constant MIN_GAS_PER_WITHDRAWAL = 100000;
    uint256 private constant RESERVATION_BUFFER_BPS = 500;

    IERC20 public usdc;
    uint256 private _lpTotalShares;
    mapping(address => uint256) private _lpShares;
    uint256 public totalBorrowed;
    int256 public pendingPnL; // deprecated: kept for storage layout compatibility
    mapping(address => DataTypes.MarketExposure) private _exposures;
    uint256 public defaultMaxExposureBps;
    uint256 public restrictionThresholdBps;
    uint256 public emergencyThresholdBps;
    bool private _emergencyMode;
    uint256 public emergencyModeActivatedAt;
    uint256 public constant MAX_EMERGENCY_DURATION = 7 days;

    uint256 public minInitialDeposit;
    mapping(uint256 => DataTypes.WithdrawalRequest) private _withdrawalRequests;
    uint256 private _nextRequestId;
    mapping(address => uint256[]) private _userWithdrawalRequests;
    uint256 public withdrawalCooldown;
    address public tradingCore;
    uint256 public reservedLiquidity;

    uint256 private _lpAssets;
    uint256 private _insAssets;

    uint256 private _insTotalShares;
    mapping(address => uint256) private _insShares;
    uint256 public targetRatioBps;
    uint256 public minRatioBps;
    uint256 public protocolTVL;
    uint256 public maxProtocolTVL;
    uint256 public approvalThreshold;
    mapping(uint256 => DataTypes.BadDebtClaim) private _claims;
    uint256 private _nextClaimId;
    uint256 public totalPendingClaims;
    uint256 public accumulatedFees;
    address public treasury;
    uint256 public treasurySurplusShareBps;
    uint256 public unstakeCooldown;
    mapping(address => uint256) private _unstakeRequestTime;
    mapping(address => uint256) private _unstakeSnapshotInsAssets;
    mapping(address => uint256) private _unstakeSnapshotInsTotalShares;

    uint256 public rateLimitCurrentLevel;
    uint256 public rateLimitLastUpdate;
    uint256 public constant CLAIM_WINDOW_DURATION = 1 hours;
    uint256 public maxClaimsPerWindow;

    uint256 public cumulativeBadDebt24h;
    uint256 public lastBadDebtResetTime;
    uint256 public constant BAD_DEBT_CIRCUIT_BREAKER_BPS = 1000;
    bool public insuranceCircuitBreakerActive;
    mapping(address => uint256) public marketBadDebtLimit;
    uint256 public defaultMarketBadDebtLimit;

    // 48h timelock for treasury rotations. Two slots from the upgrade gap.
    uint256 private constant TREASURY_TIMELOCK = 48 hours;
    address private _pendingTreasury;
    uint256 private _pendingTreasuryEffective;

    // 48h timelock for TradingCore rotation. Two slots from the remaining gap.
    address private _pendingTradingCore;
    uint256 private _pendingTradingCoreEffective;

    // untracked USDC donations are isolated from the LP pool until governance sweeps.
    uint256 private _donatedAssets;

    // per-user cap on queued withdrawals.
    uint256 public maxWithdrawalsPerUser;

    uint256 public minInitialInsuranceDeposit;

    mapping(address => uint256) public collateralReserves;

    mapping(address => bool) public allowedSwapRouters;
    uint256 public minSwapSlippageBps;
    uint256 private constant DEFAULT_MIN_SWAP_SLIPPAGE_BPS = 9500; // 95%

    // ─── Referral rebates ──────────────────────────────────────────────────
    /// @dev Per-referrer USDC owed (6 decimals). Funded by `accrueRebate` which
    ///      pulls USDC from the caller (TradingCore) so the vault is the
    ///      single source of truth for outstanding rebate balances.
    mapping(address => uint256) private _referralRebates;
    /// @dev Sum of `_referralRebates` so we can isolate rebate USDC from the
    ///      LP/insurance accounting. Without this, rebate balances sitting in
    ///      the vault would inflate `getAvailableLiquidity()` / `totalAssets()`
    ///      and silently dilute LP shares.
    uint256 private _pendingRebates;

    // upgrade gap reduced for `_pendingTreasury`/`_pendingTradingCore` slots.
    uint256[6] private __gap;

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalQueued(address indexed user, uint256 shares, uint256 requestId);
    event WithdrawalProcessed(uint256 indexed requestId, address indexed user, uint256 assets);
    event WithdrawalCancelled(uint256 indexed requestId, address indexed user, string reason);
    event ExposureUpdated(address indexed market, uint256 longExposure, uint256 shortExposure);
    event PnLSettled(address indexed market, int256 pnl, bool isProfit);
    event EmergencyModeActivated(uint256 timestamp);
    event EmergencyModeDeactivated(uint256 timestamp);
    event UtilizationAlert(uint256 utilization, bool isEmergency);
    event ExposureCapUpdated(address indexed market, uint256 oldCap, uint256 newCap);
    event ThresholdsUpdated(uint256 restrictionBps, uint256 emergencyBps);
    event InsuranceStaked(address indexed user, uint256 assets, uint256 shares);
    event InsuranceUnstaked(address indexed user, uint256 assets, uint256 shares);
    event BadDebtCovered(uint256 indexed claimId, uint256 amount, uint256 positionId);
    event ClaimSubmitted(uint256 indexed claimId, uint256 amount, uint256 positionId);
    event FeeReceived(uint256 amount, string feeType);
    event SurplusDistributed(uint256 total, uint256 stakerShare, uint256 treasuryShare);
    event ProtocolTVLUpdated(uint256 oldTVL, uint256 newTVL);
    event UnstakeRequested(address indexed user, uint256 timestamp);
    event InsuranceCircuitBreakerTriggered(uint256 threshold, uint256 cumulative);
    event InsuranceCircuitBreakerReset(address indexed resetter);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event RebateAccrued(address indexed referrer, uint256 amount);
    event RebateClaimed(address indexed referrer, address to, uint256 amount);

    event EmergencyEscapeWithdrawCapped(
        address indexed user,
        uint256 requestedAssets,
        uint256 actualAssets,
        uint256 shares
    );
    event ClaimPartialPayment(uint256 indexed claimId, uint256 paid, uint256 remaining);
    event TreasuryProposed(address indexed pending, uint256 effective);

    modifier notEmergencyMode() {
        if (_emergencyMode) revert EmergencyModeActive();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    error InvalidUsdcDecimals();

    /// @notice Initialize the vault proxy: USDC asset, roles, and default risk parameters.
    function initialize(address admin, address _usdc, address _treasury) external initializer {
        if (admin == address(0) || _usdc == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        // All internal precision conversions hardcode a 6-decimal collateral
        // asset (`DataTypes.DECIMAL_CONVERSION = 1e12`). Deploying against a
        // token with different decimals would silently corrupt every
        // share/borrow/PnL conversion. Fail loudly at init instead.
        if (IERC20Metadata(_usdc).decimals() != USDC_DECIMALS) revert InvalidUsdcDecimals();

        __ReentrancyGuard_init();
        __AccessControlled_init(admin);
        __UUPSUpgradeable_init();

        usdc = IERC20(_usdc);
        treasury = _treasury;

        defaultMaxExposureBps = 2000;
        restrictionThresholdBps = 7500;
        emergencyThresholdBps = 9000;
        minInitialDeposit = 1000e6;
        withdrawalCooldown = 1 days;
        _nextRequestId = 1;

        targetRatioBps = 1000;
        minRatioBps = 500;
        approvalThreshold = 10_000e6;
        unstakeCooldown = 7 days;
        treasurySurplusShareBps = 2000;
        _nextClaimId = 1;
        maxProtocolTVL = 1_000_000_000e6;
        maxClaimsPerWindow = 100_000e6;
        maxWithdrawalsPerUser = 10; //
        // dilution after the precision-scaled mint cannot exceed ~1 bp.
        minInitialInsuranceDeposit = 1000e6;

        _lpShares[address(1)] = DEAD_SHARES;
        _lpTotalShares = DEAD_SHARES;
        _insShares[address(1)] = DEAD_SHARES;
        _insTotalShares = DEAD_SHARES;
    }

    /// @notice Bind `TradingCore` and grant it the `TRADING_CORE_ROLE` for borrow/repay/fee hooks.
    /// @dev Rotation requires a 48h staged proposal. The first wire-up
    ///      (when `tradingCore == address(0)`) is allowed immediately so the
    ///      deployment script can finish without waiting 48h. Any subsequent
    ///      rotation requires `proposeTradingCore` then `setTradingCore`
    ///      with the exact staged address.
    function setTradingCore(address _tradingCore) external onlyAdmin {
        if (_tradingCore == address(0)) revert ZeroAddress();
        if (tradingCore == address(0)) {
            // First-time wire-up.
            tradingCore = _tradingCore;
            _grantRole(TRADING_CORE_ROLE, _tradingCore);
            return;
        }
        if (_tradingCore != _pendingTradingCore) revert PendingTradingCoreMismatch();
        if (_pendingTradingCoreEffective == 0 || block.timestamp < _pendingTradingCoreEffective) {
            revert TradingCoreTimelockActive();
        }
        _revokeRole(TRADING_CORE_ROLE, tradingCore);
        tradingCore = _tradingCore;
        _grantRole(TRADING_CORE_ROLE, _tradingCore);
        delete _pendingTradingCore;
        delete _pendingTradingCoreEffective;
        emit TradingCoreProposed(address(0), 0); // signal "applied" via zeroed pending
    }

    event TradingCoreProposed(address indexed pending, uint256 effective);

    /// @notice Stage a TradingCore rotation. Effective 48h later via `setTradingCore`.
    function proposeTradingCore(address _tradingCore) external onlyAdmin {
        if (_tradingCore == address(0)) revert ZeroAddress();
        _pendingTradingCore = _tradingCore;
        _pendingTradingCoreEffective = block.timestamp + TREASURY_TIMELOCK;
        emit TradingCoreProposed(_tradingCore, _pendingTradingCoreEffective);
    }

    /// @notice Read-only view of the staged TradingCore rotation, if any.
    function pendingTradingCore() external view returns (address pending, uint256 effective) {
        return (_pendingTradingCore, _pendingTradingCoreEffective);
    }

    /// @notice Mint LP shares against USDC (`IVaultCore.deposit`).
    function deposit(
        uint256 assets,
        address receiver
    ) external nonReentrant whenNotPaused notEmergencyMode returns (uint256 shares) {
        if (assets == 0) revert ZeroAssets();
        if (receiver == address(0)) revert ZeroAddress();
        if (_lpTotalShares == DEAD_SHARES) {
            // Any pre-existing USDC sent to the contract before init is donated to the dead-share slot.
            // This prevents a 1-wei front-run from bricking the protocol on first deposit while still
            // requiring the legitimate first depositor to commit at least `minInitialDeposit`.
            if (assets < minInitialDeposit) revert MinimumDepositRequired();
        }

        shares = _convertToLPShares(assets);
        if (shares == 0) revert ZeroShares();

        usdc.safeTransferFrom(msg.sender, address(this), assets);
        _lpShares[receiver] += shares;
        _lpTotalShares += shares;
        _lpAssets += assets;

        emit Deposit(msg.sender, assets, shares);
    }

    /// @notice Instant LP redemption when healthy liquidity and not in emergency (`IVaultCore.withdraw`).
    function withdraw(
        uint256 shares,
        address receiver,
        address owner
    ) external nonReentrant whenNotPaused returns (uint256 assets) {
        if (shares == 0) revert ZeroShares();
        if (receiver == address(0)) revert ZeroAddress();
        if (_lpShares[owner] < shares) revert InsufficientShares();
        if (_emergencyMode) revert EmergencyModeActive();
        if (owner != msg.sender) revert NotOwner();

        // Conservative valuation prevents extracting unrealized trader PnL.
        uint256 assetsInternal = _convertToLPAssetsConservative(shares);
        assets = DataTypes.toUsdcPrecision(assetsInternal);
        if (assets == 0) revert ZeroAssets();
        if (assets > getAvailableLiquidity()) revert InsufficientLiquidity();

        _lpShares[owner] -= shares;
        _lpTotalShares -= shares;
        _lpAssets = _lpAssets > assets ? _lpAssets - assets : 0;
        usdc.safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, assets, shares);
    }

    /// @notice Queue LP exit with cooldown and reserved liquidity (`IVaultCore.queueWithdrawal`).
    function queueWithdrawal(uint256 shares, uint256 minAssets) external nonReentrant returns (uint256 requestId) {
        if (shares == 0) revert ZeroShares();
        if (_lpShares[msg.sender] < shares) revert InsufficientShares();
        // cap queue length per user (default 0 == unlimited until configured).
        if (maxWithdrawalsPerUser > 0 && _userWithdrawalRequests[msg.sender].length >= maxWithdrawalsPerUser) {
            revert InvalidRequest();
        }

        requestId = _nextRequestId++;
        uint256 expectedAssetsUsdc = DataTypes.toUsdcPrecision(_convertToLPAssets(shares));
        uint256 reservationAmount = (expectedAssetsUsdc * (BPS + RESERVATION_BUFFER_BPS)) / BPS;

        _withdrawalRequests[requestId] = DataTypes.WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            requestTime: block.timestamp,
            minAssets: minAssets,
            processed: false,
            reservationAmount: reservationAmount
        });
        _userWithdrawalRequests[msg.sender].push(requestId);
        _lpShares[msg.sender] -= shares;
        reservedLiquidity += reservationAmount;

        emit WithdrawalQueued(msg.sender, shares, requestId);
    }

    /// @notice Cancel a queued withdrawal request before it has been
    ///         processed. Returns the reserved shares to the user and
    ///         releases the reservation. Only the original requester can
    ///         cancel.
    /// @param requestId Withdrawal id returned by `queueWithdrawal`.
    function cancelQueuedWithdrawal(uint256 requestId) external nonReentrant {
        DataTypes.WithdrawalRequest storage req = _withdrawalRequests[requestId];
        if (req.user != msg.sender) revert NotOwner();
        if (req.processed || req.shares == 0) revert InvalidRequest();

        uint256 shares = req.shares;
        uint256 reservation = req.reservationAmount;

        // Return shares first; mirrors the `queueWithdrawal` reverse
        // sequence so the share-supply invariant holds across the cancel.
        _lpShares[msg.sender] += shares;
        _releaseReserved(reservation);
        _removeUserRequest(msg.sender, requestId);
        delete _withdrawalRequests[requestId];

        emit WithdrawalCancelled(requestId, msg.sender, "UserCancelled");
    }

    /// @notice Finalize queued withdrawals subject to cooldown, slippage floor, and gas budget (`IVaultCore.processWithdrawals`).
    /// @dev Any single id that is not yet mature, has been processed, or
    ///      otherwise reverts is silently skipped so a malicious LP cannot
    ///      DoS the entire batch by mixing immature ids into the input.
    ///
    ///      We rely on per-request processing reentrancy safety: each
    ///      `_processWithdrawal` only touches storage and finally calls
    ///      `safeTransfer` to the LP user (USDC has no callbacks). The
    ///      outer batch is intentionally NOT `nonReentrant` so the inner
    ///      `try this._processWithdrawalExt` can execute under the same
    ///      transaction context. The inner function applies its own
    ///      `nonReentrant` guard to protect against any future addition.
    function processWithdrawals(uint256[] calldata requestIds) external returns (uint256 processed) {
        uint256 len = requestIds.length;
        if (len > MAX_WITHDRAWAL_BATCH) revert InvalidRequest();
        uint256 gasLimit = gasleft();
        for (uint256 i = 0; i < len && gasLimit > MIN_GAS_PER_WITHDRAWAL; ) {
            uint256 reqId = requestIds[i];
            DataTypes.WithdrawalRequest storage req = _withdrawalRequests[reqId];
            // Cheap pre-check before the external try/catch boundary.
            if (!req.processed && req.shares != 0) {
                try this._processWithdrawalExt(reqId) {
                    unchecked { ++processed; }
                } catch {
                    // not yet mature, slippage cancellation handled inside,
                    // or any other revert: skip and continue.
                }
            }
            gasLimit = gasleft();
            unchecked { ++i; }
        }
    }

    /// @notice External shim so a single immature/reverting request does
    ///         not kill the batch. Restricted to self-calls.
    function _processWithdrawalExt(uint256 requestId) external nonReentrant {
        if (msg.sender != address(this)) revert InvalidRequest();
        _processWithdrawal(requestId);
    }

    function _processWithdrawal(uint256 requestId) internal {
        DataTypes.WithdrawalRequest storage req = _withdrawalRequests[requestId];
        if (req.processed || req.shares == 0) revert InvalidRequest();
        if (block.timestamp < req.requestTime + withdrawalCooldown) revert WithdrawalNotReady();

        uint256 assets = DataTypes.toUsdcPrecision(_convertToLPAssetsConservative(req.shares));
        address user = req.user;

        // Use the reservation persisted at queue time so book-keeping stays consistent
        // even if share price has moved between queueing and processing.
        uint256 originalReservation = req.reservationAmount;

        if (req.minAssets > 0 && assets < req.minAssets) {
            _lpShares[user] += req.shares;
            _releaseReserved(originalReservation);
            _removeUserRequest(user, requestId);
            delete _withdrawalRequests[requestId];
            emit WithdrawalCancelled(requestId, user, "Slippage");
            return;
        }

        uint256 available = getAvailableLiquidity();
        if (assets > available) {
            assets = available;
            if (req.minAssets > 0 && assets < req.minAssets) {
                _lpShares[user] += req.shares;
                _releaseReserved(originalReservation);
                _removeUserRequest(user, requestId);
                delete _withdrawalRequests[requestId];
                emit WithdrawalCancelled(requestId, user, "InsufficientLiquidity");
                return;
            }
        }

        _lpTotalShares -= req.shares;
        _lpAssets = _lpAssets > assets ? _lpAssets - assets : 0;
        _releaseReserved(originalReservation);
        req.processed = true;

        _removeUserRequest(user, requestId);

        usdc.safeTransfer(user, assets);
        emit WithdrawalProcessed(requestId, user, assets);
    }

    function _releaseReserved(uint256 amount) internal {
        reservedLiquidity = reservedLiquidity > amount ? reservedLiquidity - amount : 0;
    }

    function _removeUserRequest(address user, uint256 requestId) private {
        uint256[] storage requests = _userWithdrawalRequests[user];
        uint256 len = requests.length;
        for (uint256 i = 0; i < len; ) {
            if (requests[i] == requestId) {
                requests[i] = requests[len - 1];
                requests.pop();
                break;
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice USDC attributed to the LP pool (vault balance excluding insurance, fee reserves, and untracked donations).
    /// @dev donations sent directly to the vault contract are tracked in `_donatedAssets` and
    /// excluded from the LP slice so they cannot pump LP share price unilaterally.
    function _lpBalanceSliceUSDC() private view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLp = _nonLpUsdc();
        return balance > nonLp ? balance - nonLp : 0;
    }

    /// @notice Aggregate of every USDC bucket that does NOT belong to LPs:
    ///         insurance assets, accumulated protocol fees, untracked donations,
    ///         and unclaimed referral rebates.
    /// @dev Rebates are kept here so accruing them never inflates LP share
    ///      price and a rebate claim cannot be paid out twice via an LP
    ///      withdrawal.
    function _nonLpUsdc() private view returns (uint256) {
        return _insAssets + accumulatedFees + _donatedAssets + _pendingRebates;
    }

    /// @notice Lend USDC to `TradingCore` if utilization and per-market exposure caps allow (`IVaultCore.borrow`).
    function borrow(
        uint256 amount,
        address market,
        bool isLong
    ) external nonReentrant onlyTradingCore notEmergencyMode returns (bool) {
        uint256 unreserved = getAvailableLiquidity();
        unreserved = unreserved > reservedLiquidity ? unreserved - reservedLiquidity : 0;
        if (amount > unreserved) return false;

        uint256 conservativeTotal = getConservativeTotalAssets();
        if (conservativeTotal == 0) return false;

        uint256 lpBal = _lpBalanceSliceUSDC();
        uint256 newBorrowed = totalBorrowed + amount;
        uint256 denom = lpBal + totalBorrowed;
        if (denom == 0) return false;
        uint256 newUtil = (newBorrowed * PRECISION) / denom;
        if (newUtil > (emergencyThresholdBps * PRECISION) / BPS) return false;

        DataTypes.MarketExposure storage exp = _exposures[market];
        // `exp.*Exposure` and `amount` are USDC-precision (6 dp). The
        // conservative-total bound is 18-dec internal precision, so it MUST be
        // converted to USDC precision before the comparison; otherwise the
        // bound is ~1e12x too large and the per-market exposure cap never
        // triggers (silently disabling the concentration control).
        uint256 maxExp = (DataTypes.toUsdcPrecision(conservativeTotal) * _getMaxExposureBps(market)) / BPS;
        uint256 newExp = isLong ? exp.longExposure + amount : exp.shortExposure + amount;
        if (newExp > maxExp) return false;

        totalBorrowed = newBorrowed;
        if (isLong) exp.longExposure += amount;
        else exp.shortExposure += amount;

        // Keep the LP cash counter in lock-step with the real on-hand LP slice.
        // `amount` USDC leaves the vault here; without this decrement the
        // counter would drift above the slice and the difference (which after a
        // profitable round-trip equals LP fee income + realized trader losses)
        // would later be misclassified as an external "donation" by
        // `recordDonation` and could be swept away from LPs.
        _lpAssets = _lpAssets > amount ? _lpAssets - amount : 0;

        usdc.safeTransfer(tradingCore, amount);
        if (newUtil > (restrictionThresholdBps * PRECISION) / BPS) {
            emit UtilizationAlert(newUtil, false);
        }
        return true;
    }

    /// @notice Accept repayment and PnL settlement from `TradingCore` (`IVaultCore.repay`).
    function repay(uint256 amount, address market, bool isLong, int256 pnl) external onlyTradingCore nonReentrant {
        totalBorrowed = totalBorrowed > amount ? totalBorrowed - amount : 0;

        DataTypes.MarketExposure storage exp = _exposures[market];
        if (isLong) {
            exp.longExposure = exp.longExposure > amount ? exp.longExposure - amount : 0;
        } else {
            exp.shortExposure = exp.shortExposure > amount ? exp.shortExposure - amount : 0;
        }

        uint256 receiveAmount;
        if (pnl >= 0) {
            receiveAmount = amount;
        } else {
            receiveAmount = amount + uint256(-pnl);
        }
        if (usdc.balanceOf(msg.sender) < receiveAmount) revert InsufficientRepayBalance();

        emit PnLSettled(market, pnl, pnl >= 0);
        emit ExposureUpdated(market, exp.longExposure, exp.shortExposure);
        usdc.safeTransferFrom(msg.sender, address(this), receiveAmount);
        if (pnl >= 0) usdc.safeTransfer(msg.sender, uint256(pnl));

        // Keep the LP cash counter in lock-step with the real LP slice.
        // Net USDC the vault retains from this settlement is
        // `receiveAmount - sentOut`, where `sentOut` is the trader profit paid
        // back out. This equals `amount - pnl` (principal returned, minus
        // trader profit / plus trader loss). Tracking it here means
        // `recordDonation` can only ever capture genuinely untracked external
        // transfers — never LP fee income or realized trader PnL.
        uint256 sentOut = pnl >= 0 ? uint256(pnl) : 0;
        if (receiveAmount >= sentOut) {
            _lpAssets += receiveAmount - sentOut;
        } else {
            uint256 outflow = sentOut - receiveAmount;
            _lpAssets = _lpAssets > outflow ? _lpAssets - outflow : 0;
        }
    }

    /// @notice Accept repayment and PnL settlement from TradingCore in a non-USDC token.
    /// @dev This entry is currently disabled. The previous implementation
    ///      reduced `totalBorrowed` by `amountUsdc` while only pulling the
    ///      alt-collateral token, leaving the vault appearing more solvent
    ///      than it was until a keeper completed `swapCollateralToUsdc`.
    ///      Until the accounting is redesigned to track per-position pending
    ///      swap value and refuse new borrows while the bridge is non-empty,
    ///      this entry is intentionally disabled. No callers in the current
    ///      codebase invoke it.
    function repayWithCollateral(
        uint256 /* amountUsdc */,
        address /* market */,
        bool /* isLong */,
        int256 /* pnlUsdc */,
        address /* collateralToken */,
        uint256 /* tokenAmount */
    ) external view onlyTradingCore {
        revert InvalidRequest();
    }

    /// @notice Disabled. Operator-supplied `minUsdcOut` previously allowed
    ///         draining alt collateral at any rate; the documented
    ///         `minSwapSlippageBps` floor was never enforced and there was
    ///         no whitelist on router function selectors. The function is
    ///         disabled until a redesigned implementation derives the
    ///         minimum receive amount from an on-chain oracle and gates the
    ///         allowed swap selectors.
    function swapCollateralToUsdc(
        address /* token */,
        uint256 /* amount */,
        uint256 /* minUsdcOut */,
        address /* router */,
        bytes calldata /* swapData */
    ) external view onlyOperator {
        revert InvalidRequest();
    }

    function setSwapRouterAllowed(address router, bool allowed) external onlyAdmin {
        if (router == address(0)) revert ZeroAddress();
        allowedSwapRouters[router] = allowed;
    }

    function setMinSwapSlippageBps(uint256 bps) external onlyAdmin {
        if (bps > BPS) revert InvalidRequest();
        minSwapSlippageBps = bps;
    }

    /// @notice Update open-interest counters without moving tokens (`IVaultCore.updateExposure`).
    function updateExposure(address market, int256 sizeDelta, bool isLong) external onlyTradingCore {
        DataTypes.MarketExposure storage exp = _exposures[market];
        if (sizeDelta > 0) {
            if (isLong) exp.longExposure += uint256(sizeDelta);
            else exp.shortExposure += uint256(sizeDelta);
        } else {
            uint256 delta = uint256(-sizeDelta);
            if (isLong) {
                exp.longExposure = exp.longExposure > delta ? exp.longExposure - delta : 0;
            } else {
                exp.shortExposure = exp.shortExposure > delta ? exp.shortExposure - delta : 0;
            }
        }

        uint256 newExp = isLong ? exp.longExposure : exp.shortExposure;
        // Convert the 18-dec internal-precision conservative total to USDC
        // precision so it shares the units of the USDC-precision exposure
        // counters (see `borrow`). Without this the cap is ~1e12x too loose.
        uint256 maxExp = (DataTypes.toUsdcPrecision(getConservativeTotalAssets()) * _getMaxExposureBps(market)) / BPS;
        if (newExp > maxExp) revert ExceedsExposureCap();

        emit ExposureUpdated(market, exp.longExposure, exp.shortExposure);
    }

    /// @notice Stake USDC into the insurance pool (`IVaultCore.stakeInsurance`).
    function stakeInsurance(
        uint256 assets,
        address receiver
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        if (assets == 0) revert ZeroAssets();
        if (receiver == address(0)) revert ZeroAddress();

        // at least `minInitialInsuranceDeposit` so the dead-share dilution after
        // the precision-scaled mint stays bounded.
        if (_insAssets == 0 && minInitialInsuranceDeposit > 0 && assets < minInitialInsuranceDeposit) {
            revert MinimumInsuranceDepositRequired();
        }

        shares = _convertToInsShares(assets);
        if (shares == 0) revert ZeroAssets();

        usdc.safeTransferFrom(msg.sender, address(this), assets);

        _insShares[receiver] += shares;
        _insTotalShares += shares;
        _insAssets += assets;

        emit InsuranceStaked(receiver, assets, shares);
    }

    function unstakeInsurance(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAssets();
        if (receiver == address(0)) revert ZeroAddress();
        if (_insShares[msg.sender] < shares) revert InsufficientShares();

        if (_unstakeRequestTime[msg.sender] == 0) {
            revert CooldownNotStarted();
        }
        if (block.timestamp < _unstakeRequestTime[msg.sender] + unstakeCooldown) {
            revert CooldownNotComplete();
        }

        uint256 snapAssets = _unstakeSnapshotInsAssets[msg.sender];
        uint256 snapShares = _unstakeSnapshotInsTotalShares[msg.sender];
        // Cap at the current live ratio so the redeemer never extracts more
        // than the pool currently has (covers the case where insurance was
        // partially drained between request and redeem).
        uint256 snapshotAssets = snapShares == 0 ? 0 : (shares * snapAssets) / snapShares;
        uint256 liveAssets = _convertToInsAssets(shares);
        assets = snapshotAssets < liveAssets ? snapshotAssets : liveAssets;

        uint256 newInsAssets = _insAssets > assets ? _insAssets - assets : 0;

        // Use on-chain-derived TVL (`getProtocolTVL`) instead of the legacy
        // operator-settable `protocolTVL`. This removes the operator-side
        // lever that could otherwise lock insurance unstakes during stress.
        uint256 currentTVL = getProtocolTVL();
        if (currentTVL > 0 && (newInsAssets * BPS) / currentTVL < minRatioBps) {
            revert UnhealthyRatio();
        }

        _insShares[msg.sender] -= shares;
        _insTotalShares -= shares;
        _insAssets = newInsAssets;
        _unstakeRequestTime[msg.sender] = 0;
        _unstakeSnapshotInsAssets[msg.sender] = 0;
        _unstakeSnapshotInsTotalShares[msg.sender] = 0;

        usdc.safeTransfer(receiver, assets);
        emit InsuranceUnstaked(msg.sender, assets, shares);
    }

    function requestUnstake() external {
        uint256 existing = _unstakeRequestTime[msg.sender];
        if (existing != 0) {
            emit UnstakeRequested(msg.sender, existing);
            return;
        }
        _unstakeRequestTime[msg.sender] = block.timestamp;
        // the price observed at request time (capped by the live ratio).
        _unstakeSnapshotInsAssets[msg.sender] = _insAssets;
        _unstakeSnapshotInsTotalShares[msg.sender] = _insTotalShares;
        emit UnstakeRequested(msg.sender, block.timestamp);
    }

    /// @notice Cancel an active unstake cooldown .
    function cancelUnstakeRequest() external {
        if (_unstakeRequestTime[msg.sender] == 0) revert CooldownNotStarted();
        _unstakeRequestTime[msg.sender] = 0;
        // Clear the snapshot too, so a fresh request takes a fresh ratio.
        _unstakeSnapshotInsAssets[msg.sender] = 0;
        _unstakeSnapshotInsTotalShares[msg.sender] = 0;
    }

    /// @notice Timestamp when `user` last called `requestUnstake` (`0` if none or cleared after `unstakeInsurance`).
    function unstakeRequestTime(address user) external view returns (uint256) {
        return _unstakeRequestTime[user];
    }

    /// @notice Insurance payout to cover trading bad debt (`IVaultCore.coverBadDebt`).
    function coverBadDebt(uint256 amount, uint256 positionId) external onlyTradingCore returns (uint256 covered) {
        if (insuranceCircuitBreakerActive) revert InsuranceFundCircuitBreakerActive();

        // ----- Pre-flight the breaker check BEFORE allocating a claim id. ----
        uint256 available = _insAssets;
        covered = amount > available ? available : amount;

        if (block.timestamp > lastBadDebtResetTime + 24 hours) {
            cumulativeBadDebt24h = 0;
            lastBadDebtResetTime = block.timestamp;
        }
        uint256 newCumulative = cumulativeBadDebt24h + covered;
        uint256 circuitBreakerThreshold = (_insAssets * BAD_DEBT_CIRCUIT_BREAKER_BPS) / BPS;
        if (newCumulative > circuitBreakerThreshold) {
            insuranceCircuitBreakerActive = true;
            // No claim was created → no rollback bookkeeping needed. Indexers see
            // exactly one event for this code path.
            emit InsuranceCircuitBreakerTriggered(circuitBreakerThreshold, newCumulative);
            return 0;
        }
        // -----------------------------------------------------------------------------

        // Now safe to materialize the governance claim: the breaker did not trip
        // on this payout and we are committed to either paying or partially-paying.
        uint256 governanceClaimId;
        if (amount > approvalThreshold) {
            governanceClaimId = _submitClaimInternal(amount, positionId);
        }

        // here. Auto-payouts inside a liquidation/close are already gated by
        // (a) `_insAssets` available, and (b) the 24h cumulative breaker.
        // Consuming the leaky bucket on the synchronous path lets a flood of
        // deadlock. Rate-limiting now lives only on the governance
        // `submitClaim`/`processClaim` flow (see `_processClaim`).

        if (covered > 0) {
            // defensive guard; covered is always <= _insAssets at this point.
            if (covered > _insAssets) covered = _insAssets;
            // rate-limit budget. The previous policy exempted under-threshold
            // auto-payouts entirely, leaving only the 24h cumulative breaker
            // (10% of insurance) to throttle micro-liquidation drains. Apply
            // the leaky-bucket here, before the debit, so a flood of small
            // events back off naturally.
            _checkClaimRateLimit(covered);
            _insAssets -= covered;
            cumulativeBadDebt24h += covered;
            usdc.safeTransfer(tradingCore, covered);

            if (amount > approvalThreshold) {
                DataTypes.BadDebtClaim storage claim = _claims[governanceClaimId];
                claim.amountPaid += covered;
                if (totalPendingClaims >= covered) {
                    totalPendingClaims -= covered;
                } else {
                    totalPendingClaims = 0;
                }
                emit BadDebtCovered(governanceClaimId, covered, positionId);
                if (claim.amountPaid < claim.amount) {
                    emit ClaimPartialPayment(governanceClaimId, covered, claim.amount - claim.amountPaid);
                } else {
                    claim.paid = true;
                }
            } else {
                uint256 claimId = _nextClaimId++;
                _claims[claimId] = DataTypes.BadDebtClaim({
                    amount: amount,
                    positionId: positionId,
                    timestamp: block.timestamp,
                    approved: true,
                    paid: amount == covered,
                    amountPaid: covered
                });
                emit BadDebtCovered(claimId, covered, positionId);
            }
        }
    }

    function _submitClaimInternal(uint256 amount, uint256 positionId) private returns (uint256 claimId) {
        claimId = _nextClaimId++;
        bool autoApprove = amount <= approvalThreshold;

        // rate-limit budget is consumed inside `_processClaim` to avoid double counting.
        _claims[claimId] = DataTypes.BadDebtClaim({
            amount: amount,
            positionId: positionId,
            timestamp: block.timestamp,
            approved: autoApprove,
            paid: false,
            amountPaid: 0
        });
        totalPendingClaims += amount;
        emit ClaimSubmitted(claimId, amount, positionId);
        if (autoApprove) _processClaim(claimId);
    }

    /// @notice `TradingCore` entry to submit a bad-debt claim (`IVaultCore.submitClaim`).
    function submitClaim(uint256 amount, uint256 positionId) external onlyTradingCore returns (uint256 claimId) {
        return _submitClaimInternal(amount, positionId);
    }

    /// @notice Guardian approval step before `processClaim` (`IVaultCore.approveClaim`).
    function approveClaim(uint256 claimId) external onlyGuardian {
        DataTypes.BadDebtClaim storage claim = _claims[claimId];
        if (claim.amount == 0 || claim.paid) revert ClaimInvalidOrPaid();
        claim.approved = true;
    }

    /// @notice Pay out an approved claim in USDC chunks (`IVaultCore.processClaim`).
    function processClaim(uint256 claimId) external nonReentrant returns (uint256) {
        return _processClaim(claimId);
    }

    function _processClaim(uint256 claimId) internal returns (uint256 paid) {
        DataTypes.BadDebtClaim storage claim = _claims[claimId];
        if (claim.amount == 0 || claim.paid || !claim.approved) revert ClaimNotApproved();

        uint256 remaining = claim.amount - claim.amountPaid;
        uint256 available = _insAssets;
        paid = remaining > available ? available : remaining;
        // enforce the same per-window rate limit on governance-approved claim payouts.
        if (paid > 0) {
            _checkClaimRateLimit(paid);
        }
        claim.amountPaid += paid;
        totalPendingClaims -= paid;
        _insAssets = _insAssets > paid ? _insAssets - paid : 0;

        if (paid > 0) usdc.safeTransfer(tradingCore, paid);
        emit BadDebtCovered(claimId, paid, claim.positionId);
        if (claim.amountPaid < claim.amount) {
            emit ClaimPartialPayment(claimId, paid, claim.amount - claim.amountPaid);
        } else {
            claim.paid = true;
        }
    }

    function _checkClaimRateLimit(uint256 amount) internal {
        if (rateLimitLastUpdate == 0) {
            rateLimitLastUpdate = block.timestamp;
            rateLimitCurrentLevel = amount;
            return;
        }

        uint256 timePassed = block.timestamp - rateLimitLastUpdate;

        if (timePassed > 0) {
            uint256 leakage = (timePassed * maxClaimsPerWindow) / CLAIM_WINDOW_DURATION;

            if (leakage >= rateLimitCurrentLevel) {
                rateLimitCurrentLevel = 0;
            } else {
                rateLimitCurrentLevel -= leakage;
            }
            rateLimitLastUpdate = block.timestamp;
        }

        if (rateLimitCurrentLevel + amount > maxClaimsPerWindow) {
            revert ClaimRateLimitExceeded();
        }

        rateLimitCurrentLevel += amount;
    }

    /// @notice Credit trading fees from `TradingCore` (`IVaultCore.receiveFees`).
    /// @dev Pulls USDC from the caller (TradingCore). Caller must approve
    ///      this vault for `amount` USDC before invocation. The pull
    ///      ensures `accumulatedFees` only grows when USDC actually arrives.
    function receiveFees(uint256 amount) external onlyTradingCore {
        if (amount == 0) return;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        accumulatedFees += amount;
        emit FeeReceived(amount, "trading");
    }

    /// @notice Credit the LP-pool fee share from `TradingCore`.
    /// @dev Pulls USDC from the caller and increments `_lpAssets` so the LP
    ///      cash counter stays in lock-step with the real LP slice. Previously
    ///      the LP fee share arrived via a raw `safeTransfer`, which raised the
    ///      balance-derived LP slice without bumping `_lpAssets`; the resulting
    ///      drift was then misclassified as an external "donation" by
    ///      `recordDonation` (and could be swept away from LPs). Routing the LP
    ///      fee through this accounted hook closes that gap while still letting
    ///      the fee legitimately raise LP share price. Caller must approve this
    ///      vault for `amount` USDC before invocation.
    function receiveLpFees(uint256 amount) external onlyTradingCore {
        if (amount == 0) return;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _lpAssets += amount;
        emit FeeReceived(amount, "lp");
    }

    /// @notice Sweep insurance surplus above target to configured recipients (`IVaultCore.distributeSurplus`).
    function distributeSurplus() external nonReentrant whenNotPaused {
        uint256 currentAssets = _insAssets;
        // On-chain-derived TVL replaces the legacy operator setter.
        uint256 targetAssets = (getProtocolTVL() * targetRatioBps) / BPS;
        if (currentAssets <= targetAssets) return;

        uint256 surplus = currentAssets - targetAssets;
        if (surplus > accumulatedFees) surplus = accumulatedFees;
        if (surplus == 0) return;

        uint256 treasuryShare = (surplus * treasurySurplusShareBps) / BPS;
        uint256 stakerShare = surplus - treasuryShare;

        // The surplus is sourced entirely from `accumulatedFees` (see the cap
        // above). `accumulatedFees -= surplus` removes BOTH shares from the fee
        // bucket. The treasury share leaves the vault via `safeTransfer`; the
        // staker share is reclassified from fees into insurance.
        //
        // The previous implementation additionally did `_insAssets -= treasuryShare`,
        // which double-debited insurance: the treasury portion was never part of
        // `_insAssets`, so subtracting it silently moved `treasuryShare` of value
        // from insurance stakers into the (balance-derived) LP slice on every call.
        if (treasuryShare > 0) {
            usdc.safeTransfer(treasury, treasuryShare);
        }
        if (stakerShare > 0) {
            _insAssets += stakerShare;
        }
        accumulatedFees -= surplus;

        emit SurplusDistributed(surplus, stakerShare, treasuryShare);
    }

    /// @notice Activate emergency mode halting normal LP withdrawals (`IVaultCore.triggerEmergencyMode`).
    function triggerEmergencyMode() external onlyGuardian {
        if (!_emergencyMode) {
            _emergencyMode = true;
            emergencyModeActivatedAt = block.timestamp;
            emit EmergencyModeActivated(block.timestamp);
        }
    }

    /// @notice Clear emergency mode once utilization is below the configured restriction threshold (`IVaultCore.stopEmergencyMode`).
    function stopEmergencyMode() external onlyAdmin {
        if (_emergencyMode && getUtilization() < (restrictionThresholdBps * PRECISION) / BPS) {
            _emergencyMode = false;
            emergencyModeActivatedAt = 0;
            emit EmergencyModeDeactivated(block.timestamp);
        }
    }

    /// @notice Pro-rata LP withdrawal after emergency timelock when normal `withdraw` is frozen.
    /// @dev Uses conservative asset valuation; payout may be capped by actual USDC on hand.
    function emergencyEscapeWithdraw(uint256 shares) external nonReentrant {
        if (!_emergencyMode) revert NotEmergencyMode();
        if (block.timestamp < emergencyModeActivatedAt + MAX_EMERGENCY_DURATION) {
            revert EscapeTimelockNotExpired();
        }

        uint256 totalShares = _lpTotalShares;
        if (totalShares == 0) revert ZeroShares();
        if (shares == 0) revert ZeroShares();
        if (shares > _lpShares[msg.sender]) revert InsufficientShares();

        uint256 requestedAssets = (shares * getConservativeTotalAssets()) / totalShares;
        requestedAssets /= DataTypes.DECIMAL_CONVERSION;
        _lpShares[msg.sender] -= shares;
        _lpTotalShares = totalShares >= shares ? totalShares - shares : 0;

        uint256 lpAvailable = getAvailableLiquidity();
        uint256 assets = requestedAssets > lpAvailable ? lpAvailable : requestedAssets;
        if (requestedAssets > lpAvailable && requestedAssets > 0) {
            emit EmergencyEscapeWithdrawCapped(msg.sender, requestedAssets, assets, shares);
        }

        _lpAssets = _lpAssets > assets ? _lpAssets - assets : 0;

        if (assets > 0) {
            usdc.safeTransfer(msg.sender, assets);
        }

        emit Withdraw(msg.sender, assets, shares);
    }

    /// @notice Update treasury recipient for surplus and fee routing.
    /// @dev gated by a 48h timelock via `proposeTreasury` -> `executeTreasury`.
    function setTreasury(address _treasury) external onlyAdmin {
        if (_treasury == address(0)) revert ZeroAddress();
        if (_treasury != _pendingTreasury) revert PendingTreasuryMismatch();
        if (block.timestamp < _pendingTreasuryEffective) revert TreasuryTimelockActive();
        address oldTreasury = treasury;
        treasury = _treasury;
        delete _pendingTreasury;
        delete _pendingTreasuryEffective;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /// @notice Stage a treasury rotation; takes effect 48h later via `setTreasury`.
    function proposeTreasury(address _treasury) external onlyAdmin {
        if (_treasury == address(0)) revert ZeroAddress();
        _pendingTreasury = _treasury;
        _pendingTreasuryEffective = block.timestamp + TREASURY_TIMELOCK;
        emit TreasuryProposed(_treasury, _pendingTreasuryEffective);
    }

    /// @notice Read the staged treasury rotation, if any.
    function pendingTreasury() external view returns (address pending, uint256 effective) {
        return (_pendingTreasury, _pendingTreasuryEffective);
    }

    /// @notice Per-market cap on open interest as bps of conservative TVL.
    function setMaxExposure(address market, uint256 maxBps) external onlyOperator {
        uint256 old = _exposures[market].maxExposurePercent;
        _exposures[market].maxExposurePercent = maxBps;
        emit ExposureCapUpdated(market, old, maxBps);
    }

    /// @notice Update utilization thresholds that drive alerts and emergency policy.
    function setThresholds(uint256 _restrictionBps, uint256 _emergencyBps) external onlyAdmin {
        restrictionThresholdBps = _restrictionBps;
        emergencyThresholdBps = _emergencyBps;
        emit ThresholdsUpdated(_restrictionBps, _emergencyBps);
    }

    /// @notice Operator-fed reference TVL is **deprecated**. The protocol
    ///         now derives `protocolTVL` on-chain from `totalAssets() +
    ///         insuranceAssets()` whenever insurance health / surplus
    ///         distribution / unstake checks need it. This setter is kept
    ///         for storage-layout compatibility but reverts so that legacy
    ///         off-chain tooling fails loudly rather than silently moving
    ///         numbers around. The on-chain value is read via
    ///         `getProtocolTVL()` below.
    function updateProtocolTVL(uint256 /* _tvl */) external view onlyOperator {
        revert InvalidRequest();
    }

    /// @notice Authoritative protocol TVL used for insurance ratio targets.
    ///         Derived on-chain from LP-side `totalAssets()` + insurance
    ///         tranche, both of which are tamper-resistant. Returned in
    ///         6-decimal USDC precision to match the legacy
    ///         operator-settable `protocolTVL` consumers.
    function getProtocolTVL() public view returns (uint256) {
        // totalAssets() is in 18-dec internal precision; convert to USDC.
        uint256 lpUsdc = DataTypes.toUsdcPrecision(totalAssets());
        return lpUsdc + _insAssets;
    }

    /// @notice Raise/lower the ceiling for `updateProtocolTVL`.
    function setMaxProtocolTVL(uint256 _maxTVL) external onlyAdmin {
        maxProtocolTVL = _maxTVL;
    }

    /// @notice cap on the number of pending withdrawal requests per user (0 == unlimited).
    function setMaxWithdrawalsPerUser(uint256 cap) external onlyAdmin {
        maxWithdrawalsPerUser = cap;
    }

    function setMinInitialInsuranceDeposit(uint256 amount) external onlyAdmin {
        if (amount > 100_000e6) revert InvalidRequest();
        minInitialInsuranceDeposit = amount;
    }

    /// @notice Clear insurance bad-debt circuit breaker after operational review.
    function resetInsuranceCircuitBreaker() external onlyAdmin {
        insuranceCircuitBreakerActive = false;
        cumulativeBadDebt24h = 0;
        lastBadDebtResetTime = block.timestamp;
        emit InsuranceCircuitBreakerReset(msg.sender);
    }

    /// @notice Sync the donation ledger with the actual USDC balance .
    /// @dev Reads `usdc.balanceOf` and treats any USDC not already attributed (LP slice + insurance + fees + prior donations)
    /// as a fresh donation. Permissionless because it only moves untracked balance into a tracked counter.
    function recordDonation() external returns (uint256 donated) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 tracked = _nonLpUsdc();
        uint256 lpSlice = balance > tracked ? balance - tracked : 0;
        // After donation accounting `_lpAssets` is the LP balance counter the contract maintains;
        // anything beyond that on top of the tracked categories is a donation.
        if (lpSlice > _lpAssets) {
            donated = lpSlice - _lpAssets;
            _donatedAssets += donated;
            emit FeeReceived(donated, "donation");
        }
    }

    /// @notice Sweep donated USDC into the LP pool, insurance pool, or treasury.
    /// @param toLpAmount USDC moved into the LP slice (raises share price for existing LPs).
    /// @param toInsuranceAmount USDC moved into insurance reserves.
    /// @param toTreasuryAmount USDC sent directly to treasury.
    function sweepDonations(
        uint256 toLpAmount,
        uint256 toInsuranceAmount,
        uint256 toTreasuryAmount
    ) external onlyAdmin {
        uint256 total = toLpAmount + toInsuranceAmount + toTreasuryAmount;
        if (total > _donatedAssets) revert InvalidRequest();
        _donatedAssets -= total;
        if (toLpAmount > 0) {
            _lpAssets += toLpAmount;
        }
        if (toInsuranceAmount > 0) {
            _insAssets += toInsuranceAmount;
        }
        if (toTreasuryAmount > 0) {
            usdc.safeTransfer(treasury, toTreasuryAmount);
        }
    }

    /// @notice Untracked donation balance pending sweep .
    function donatedAssets() external view returns (uint256) {
        return _donatedAssets;
    }

    /// @notice LP-side assets including borrows and global PnL adjustment from `TradingCore` when available (`IVaultCore.totalAssets`).
    /// @dev Previously reverted when `tradingViews` was unset on
    ///      `TradingCore` (initial deploy ordering). Now degrades gracefully —
    ///      a failure of the global-PnL probe is treated as zero adjustment so
    ///      LP deposit/withdraw flows do not brick during deployment.
    function totalAssets() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLpAssets = _nonLpUsdc(); // exclude insurance, fees, donations, rebates.
        uint256 lpBalance = balance > nonLpAssets ? balance - nonLpAssets : 0;
        uint256 total = (lpBalance * DataTypes.DECIMAL_CONVERSION) + (totalBorrowed * DataTypes.DECIMAL_CONVERSION);

        if (tradingCore != address(0)) {
            try ITradingCore(tradingCore).getGlobalUnrealizedPnL() returns (int256 globalPnL) {
                if (globalPnL >= 0) {
                    uint256 liability = uint256(globalPnL);
                    return total > liability ? total - liability : 0;
                } else {
                    return total + uint256(-globalPnL);
                }
            } catch {
                // tradingViews not yet wired or temporarily reverting; treat as zero
                // adjustment. Conservative-side helpers below use the same fallback.
                return total;
            }
        }
        return total;
    }

    /// @notice Raw USDC held for insurance stakers (`IVaultCore.insuranceAssets`).
    function insuranceAssets() public view returns (uint256) {
        return _insAssets;
    }

    /// @notice Accounting balance for LP pool excluding insurance/fees slice.
    function lpAssets() public view returns (uint256) {
        return _lpAssets;
    }

    /// @notice Total LP shares outstanding (`IVaultCore.lpTotalShares`).
    function lpTotalShares() external view returns (uint256) {
        return _lpTotalShares;
    }

    /// @notice Total insurance shares outstanding (`IVaultCore.insTotalShares`).
    function insTotalShares() external view returns (uint256) {
        return _insTotalShares;
    }

    /// @notice Borrowed USDC vs LP assets including PnL adjustments (`IVaultCore.getUtilization`).
    function getUtilization() public view returns (uint256) {
        uint256 a = totalAssets();
        return a == 0 ? 0 : (totalBorrowed * DataTypes.DECIMAL_CONVERSION * PRECISION) / a;
    }

    /// @notice Conservative LP asset figure ignoring positive trader PnL liability for safety checks.
    /// @dev Matching `totalAssets` graceful degradation on tradingViews unset.
    function getConservativeTotalAssets() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLpAssets = _nonLpUsdc();
        uint256 lpBalance = balance > nonLpAssets ? balance - nonLpAssets : 0;
        uint256 total = (lpBalance * DataTypes.DECIMAL_CONVERSION) + (totalBorrowed * DataTypes.DECIMAL_CONVERSION);

        if (tradingCore != address(0)) {
            try ITradingCore(tradingCore).getGlobalUnrealizedPnL() returns (int256 globalPnL) {
                if (globalPnL > 0) {
                    uint256 liability = uint256(globalPnL);
                    return total > liability ? total - liability : 0;
                }
            } catch {
                // graceful degradation: assume no positive trader PnL adjustment.
                return total;
            }
        }
        return total;
    }

    /// @notice Utilization using on-hand LP slice without global PnL uplift.
    function getConservativeUtilization() public view returns (uint256) {
        uint256 lpBal = _lpBalanceSliceUSDC();
        uint256 denom = lpBal + totalBorrowed;
        return denom == 0 ? 0 : (totalBorrowed * PRECISION) / denom;
    }

    function getAvailableLiquidity() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLpAssets = _nonLpUsdc();
        uint256 lpUnreserved = balance > nonLpAssets ? balance - nonLpAssets : 0;
        return lpUnreserved > reservedLiquidity ? lpUnreserved - reservedLiquidity : 0;
    }

    /// @notice LP share price in internal precision (`IVaultCore.getLPSharePrice`).
    function getLPSharePrice() public view returns (uint256) {
        return _lpTotalShares == 0 ? PRECISION : (totalAssets() * PRECISION) / _lpTotalShares;
    }

    /// @notice Per-market long/short exposure snapshot (`IVaultCore.getMarketExposure`).
    function getMarketExposure(address market) external view returns (DataTypes.MarketExposure memory) {
        return _exposures[market];
    }

    /// @notice Whether emergency pause of LP withdrawals is active (`IVaultCore.isEmergencyMode`).
    function isEmergencyMode() external view returns (bool) {
        return _emergencyMode;
    }

    /// @notice LP share balance for `user` (`IVaultCore.lpBalanceOf`).
    function lpBalanceOf(address user) external view returns (uint256) {
        return _lpShares[user];
    }

    /// @notice Insurance share balance for `user` (`IVaultCore.insBalanceOf`).
    function insBalanceOf(address user) external view returns (uint256) {
        return _insShares[user];
    }

    /// @notice Shares minted for an LP deposit at current exchange rate (`IVaultCore.previewDeposit`).
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _convertToLPShares(assets);
    }

    /// @notice Internal-precision assets returned for burning `shares` (`IVaultCore.previewWithdraw`).
    function previewWithdraw(uint256 shares) public view returns (uint256) {
        return _convertToLPAssets(shares);
    }

    /// @notice Metadata for a queued withdrawal (`IVaultCore.getWithdrawalRequest`).
    function getWithdrawalRequest(uint256 requestId) external view returns (DataTypes.WithdrawalRequest memory) {
        return _withdrawalRequests[requestId];
    }

    /// @notice Bad-debt claim record (`IVaultCore.getClaim`).
    function getClaim(uint256 claimId) external view returns (DataTypes.BadDebtClaim memory) {
        return _claims[claimId];
    }

    /// @notice Insurance assets divided by `getProtocolTVL()`, scaled by `BPS` (`IVaultCore.getInsuranceHealthRatio`).
    function getInsuranceHealthRatio() public view returns (uint256) {
        uint256 tvl = getProtocolTVL();
        return tvl == 0 ? PRECISION : (_insAssets * BPS) / tvl;
    }

    /// @notice True when `getInsuranceHealthRatio()` is at least `minRatioBps` (`IVaultCore.isInsuranceHealthy`).
    function isInsuranceHealthy() external view returns (bool) {
        return getInsuranceHealthRatio() >= minRatioBps;
    }

    /// @notice Underlying ERC20 asset address (`IVaultCore.asset`).
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice `assets` -> LP shares at current rate (`IVaultCore.convertToShares`).
    function convertToShares(uint256 assets) external view returns (uint256) {
        return _convertToLPShares(assets);
    }

    /// @notice LP shares -> internal-precision assets (`IVaultCore.convertToAssets`).
    function convertToAssets(uint256 shares) external view returns (uint256) {
        return _convertToLPAssets(shares);
    }

    /// @notice ERC4626-style max deposit hint (`IVaultCore.maxDeposit`).
    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Max redeemable LP shares for `owner` (zero during emergency) (`IVaultCore.maxRedeem`).
    function maxRedeem(address owner) external view returns (uint256) {
        return _emergencyMode ? 0 : _lpShares[owner];
    }

    function _convertToLPShares(uint256 assets) internal view returns (uint256) {
        // Price deposits on the CONSERVATIVE total (same mark used for
        // withdrawals) so entry and exit are symmetric. Pricing on
        // `totalAssets()` would add unrealized trader *losses* to NAV and
        // overcharge new depositors for value that may never materialize,
        // while still letting withdrawals use the lower conservative mark.
        // Using the conservative total on both sides keeps round-trips at par
        // and does not dilute existing LPs (both sides share one mark).
        uint256 total = getConservativeTotalAssets();
        if (_lpTotalShares == 0 || total == 0) {
            // `_nonLpUsdc()` helper so donations and pending rebates are never
            // double-counted into the LP slice during first-deposit / drained
            // states. Previous code excluded only `_insAssets + accumulatedFees`.
            uint256 balance = usdc.balanceOf(address(this));
            uint256 nonLpAssets = _nonLpUsdc();
            uint256 lpBalance = balance > nonLpAssets ? balance - nonLpAssets : 0;
            uint256 rawTotal = lpBalance + totalBorrowed;
            if (rawTotal == 0) {
                return assets * (10 ** (SHARE_DECIMALS - USDC_DECIMALS));
            }
            if (rawTotal < minInitialDeposit && _lpTotalShares == DEAD_SHARES) {
                return (assets * _lpTotalShares) / minInitialDeposit;
            }
            return (assets * _lpTotalShares) / rawTotal;
        }
        uint256 assetsInternal = DataTypes.toInternalPrecision(assets);
        return (assetsInternal * _lpTotalShares) / total;
    }

    function _convertToLPAssets(uint256 shares) internal view returns (uint256) {
        return _lpTotalShares == 0 ? 0 : (shares * totalAssets()) / _lpTotalShares;
    }

    /// @dev LP redemption value uses the conservative total (subtracts unrealized trader profits, ignores unrealized
    /// trader losses). This prevents LPs from extracting paper PnL via withdrawal arbitrage .
    function _convertToLPAssetsConservative(uint256 shares) internal view returns (uint256) {
        return _lpTotalShares == 0 ? 0 : (shares * getConservativeTotalAssets()) / _lpTotalShares;
    }

    function _convertToInsShares(uint256 assets) internal view returns (uint256) {
        // post-drain), scale 6-decimal USDC up to 18-decimal share precision so
        // the dead-share allocation (`1e18` shares against 0 assets) cannot
        // dilute the first staker's ownership to ~zero. This mirrors the LP
        // path's first-deposit branch.
        if (_insAssets == 0 || _insTotalShares <= DEAD_SHARES) {
            return assets * (10 ** (SHARE_DECIMALS - USDC_DECIMALS));
        }
        return (assets * _insTotalShares) / _insAssets;
    }

    function _convertToInsAssets(uint256 shares) internal view returns (uint256) {
        return _insTotalShares == 0 || _insAssets == 0 ? 0 : (shares * _insAssets) / _insTotalShares;
    }

    function _getMaxExposureBps(address market) internal view returns (uint256) {
        uint256 custom = _exposures[market].maxExposurePercent;
        return custom > 0 ? custom : defaultMaxExposureBps;
    }

    /// @notice Accrue referral rebate for a referrer (called by TradingCore).
    /// @dev TradingCore must have approved this vault for `amount` USDC.
    ///      The vault pulls the funds itself rather than trusting the
    ///      caller transferred them — without this, a buggy or malicious
    ///      TradingCore could credit phantom rebates and silently inflate
    ///      `_pendingRebates` (and therefore deflate `getAvailableLiquidity`).
    /// @param referrer Address earning the rebate.
    /// @param amount USDC rebate amount (6 decimals).
    function accrueRebate(address referrer, uint256 amount) external onlyTradingCore {
        if (referrer == address(0) || amount == 0) return;
        // Pull from caller — invariant: USDC actually arrives before we
        // bookkeep `_pendingRebates`.
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _referralRebates[referrer] += amount;
        _pendingRebates += amount;
        emit RebateAccrued(referrer, amount);
    }

    /// @notice Referrer claims their accumulated rebates.
    /// @param to Recipient address for the USDC payout.
    /// @return claimed USDC amount transferred.
    function claimRebates(address to) external nonReentrant returns (uint256 claimed) {
        if (to == address(0)) revert ZeroAddress();
        claimed = _referralRebates[msg.sender];
        if (claimed == 0) revert InsufficientLiquidity();
        _referralRebates[msg.sender] = 0;
        // checked: invariant `_pendingRebates >= claimed` holds because every
        // accrual increments both counters by the same amount.
        _pendingRebates -= claimed;
        usdc.safeTransfer(to, claimed);
        emit RebateClaimed(msg.sender, to, claimed);
    }

    /// @notice View accumulated claimable rebates for an address.
    function claimableRebates(address referrer) external view returns (uint256) {
        return _referralRebates[referrer];
    }

    /// @notice Total USDC reserved for unclaimed referral rebates.
    function pendingRebates() external view returns (uint256) {
        return _pendingRebates;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {
        _enforceUpgradeTimelock(newImplementation);
    }
}
