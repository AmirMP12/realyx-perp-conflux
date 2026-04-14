// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10000;
    uint256 private constant SHARE_DECIMALS = 18;
    uint256 private constant USDC_DECIMALS = 6;
    uint256 private constant DEAD_SHARES = 10e6;
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

    uint256[19] private __gap;

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
    event EmergencyEscapeWithdrawCapped(
        address indexed user,
        uint256 requestedAssets,
        uint256 actualAssets,
        uint256 shares
    );
    event ClaimPartialPayment(uint256 indexed claimId, uint256 paid, uint256 remaining);

    modifier notEmergencyMode() {
        if (_emergencyMode) revert EmergencyModeActive();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the vault proxy: USDC asset, roles, and default risk parameters.
    function initialize(address admin, address _usdc, address _treasury) external initializer {
        if (admin == address(0) || _usdc == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }

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

        _lpShares[address(1)] = DEAD_SHARES;
        _lpTotalShares = DEAD_SHARES;
        _insShares[address(1)] = DEAD_SHARES;
        _insTotalShares = DEAD_SHARES;
    }

    /// @notice Bind `TradingCore` and grant it the `TRADING_CORE_ROLE` for borrow/repay/fee hooks.
    function setTradingCore(address _tradingCore) external onlyAdmin {
        if (_tradingCore == address(0)) revert ZeroAddress();
        if (tradingCore != address(0)) {
            _revokeRole(TRADING_CORE_ROLE, tradingCore);
        }
        tradingCore = _tradingCore;
        _grantRole(TRADING_CORE_ROLE, _tradingCore);
    }

    /// @notice Mint LP shares against USDC (`IVaultCore.deposit`).
    function deposit(
        uint256 assets,
        address receiver
    ) external nonReentrant whenNotPaused notEmergencyMode returns (uint256 shares) {
        if (assets == 0) revert ZeroAssets();
        if (receiver == address(0)) revert ZeroAddress();
        if (_lpTotalShares == DEAD_SHARES) {
            uint256 rawTotal = usdc.balanceOf(address(this)) + totalBorrowed;
            if (rawTotal > 0) revert InvalidFirstDeposit();
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

        uint256 assetsInternal = _convertToLPAssets(shares);
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

        requestId = _nextRequestId++;
        uint256 expectedAssetsUsdc = DataTypes.toUsdcPrecision(_convertToLPAssets(shares));
        uint256 reservationAmount = (expectedAssetsUsdc * (BPS + RESERVATION_BUFFER_BPS)) / BPS;

        _withdrawalRequests[requestId] = DataTypes.WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            requestTime: block.timestamp,
            minAssets: minAssets,
            processed: false
        });
        _userWithdrawalRequests[msg.sender].push(requestId);
        _lpShares[msg.sender] -= shares;
        reservedLiquidity += reservationAmount;

        emit WithdrawalQueued(msg.sender, shares, requestId);
    }

    /// @notice Finalize queued withdrawals subject to cooldown, slippage floor, and gas budget (`IVaultCore.processWithdrawals`).
    function processWithdrawals(uint256[] calldata requestIds) external nonReentrant returns (uint256 processed) {
        uint256 len = requestIds.length;
        if (len > MAX_WITHDRAWAL_BATCH) revert InvalidRequest();
        uint256 gasLimit = gasleft();
        for (uint256 i = 0; i < len && gasLimit > MIN_GAS_PER_WITHDRAWAL; ) {
            uint256 reqId = requestIds[i];
            DataTypes.WithdrawalRequest storage req = _withdrawalRequests[reqId];
            if (!req.processed && req.shares != 0) {
                _processWithdrawal(reqId);
                unchecked {
                    ++processed;
                }
            }
            gasLimit = gasleft();
            unchecked {
                ++i;
            }
        }
    }

    function _processWithdrawal(uint256 requestId) internal {
        DataTypes.WithdrawalRequest storage req = _withdrawalRequests[requestId];
        if (req.processed || req.shares == 0) revert InvalidRequest();
        if (block.timestamp < req.requestTime + withdrawalCooldown) revert WithdrawalNotReady();

        uint256 assets = DataTypes.toUsdcPrecision(_convertToLPAssets(req.shares));
        address user = req.user;

        uint256 originalReservation = (assets * (BPS + RESERVATION_BUFFER_BPS)) / BPS;

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

    /// @notice USDC attributed to the LP pool (vault balance excluding insurance and fee reserves).
    function _lpBalanceSliceUSDC() private view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLpAssets = _insAssets + accumulatedFees;
        return balance > nonLpAssets ? balance - nonLpAssets : 0;
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
        uint256 maxExp = (conservativeTotal * _getMaxExposureBps(market)) / BPS;
        uint256 newExp = isLong ? exp.longExposure + amount : exp.shortExposure + amount;
        if (newExp > maxExp) return false;

        totalBorrowed = newBorrowed;
        if (isLong) exp.longExposure += amount;
        else exp.shortExposure += amount;

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
        uint256 maxExp = (getConservativeTotalAssets() * _getMaxExposureBps(market)) / BPS;
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

        shares = _convertToInsShares(assets);
        if (shares == 0) revert ZeroAssets();

        usdc.safeTransferFrom(msg.sender, address(this), assets);

        _insShares[receiver] += shares;
        _insTotalShares += shares;
        _insAssets += assets;

        emit InsuranceStaked(receiver, assets, shares);
    }

    /// @notice Redeem insurance shares after cooldown and ratio checks (`IVaultCore.unstakeInsurance`).
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

        assets = _convertToInsAssets(shares);
        uint256 newInsAssets = _insAssets > assets ? _insAssets - assets : 0;

        if (protocolTVL > 0 && (newInsAssets * BPS) / protocolTVL < minRatioBps) {
            revert UnhealthyRatio();
        }

        _insShares[msg.sender] -= shares;
        _insTotalShares -= shares;
        _insAssets = newInsAssets;
        _unstakeRequestTime[msg.sender] = 0;

        usdc.safeTransfer(receiver, assets);
        emit InsuranceUnstaked(msg.sender, assets, shares);
    }

    /// @notice Start unstake cooldown for the caller (`IVaultCore.requestUnstake`).
    function requestUnstake() external {
        _unstakeRequestTime[msg.sender] = block.timestamp;
        emit UnstakeRequested(msg.sender, block.timestamp);
    }

    /// @notice Timestamp when `user` last called `requestUnstake` (`0` if none or cleared after `unstakeInsurance`).
    function unstakeRequestTime(address user) external view returns (uint256) {
        return _unstakeRequestTime[user];
    }

    /// @notice Insurance payout to cover trading bad debt (`IVaultCore.coverBadDebt`).
    function coverBadDebt(uint256 amount, uint256 positionId) external onlyTradingCore returns (uint256 covered) {
        if (insuranceCircuitBreakerActive) revert InsuranceFundCircuitBreakerActive();

        uint256 governanceClaimId;
        if (amount > approvalThreshold) {
            governanceClaimId = _submitClaimInternal(amount, positionId);
        }

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
            if (amount > approvalThreshold && governanceClaimId > 0) {
                totalPendingClaims = totalPendingClaims > amount ? totalPendingClaims - amount : 0;
                _claims[governanceClaimId].paid = true;
            }
            emit InsuranceCircuitBreakerTriggered(circuitBreakerThreshold, newCumulative);
            return 0;
        }

        if (amount > approvalThreshold) {
            _checkClaimRateLimit(covered);
        } else {
            _checkClaimRateLimit(amount);
        }

        if (covered > 0) {
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

        if (autoApprove) {
            _checkClaimRateLimit(amount);
        }

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
    function processClaim(uint256 claimId) external returns (uint256) {
        return _processClaim(claimId);
    }

    function _processClaim(uint256 claimId) internal returns (uint256 paid) {
        DataTypes.BadDebtClaim storage claim = _claims[claimId];
        if (claim.amount == 0 || claim.paid || !claim.approved) revert ClaimNotApproved();

        uint256 remaining = claim.amount - claim.amountPaid;
        uint256 available = _insAssets;
        paid = remaining > available ? available : remaining;
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
    function receiveFees(uint256 amount) external onlyTradingCore {
        if (amount == 0) return;
        accumulatedFees += amount;
        emit FeeReceived(amount, "trading");
    }

    /// @notice Sweep insurance surplus above target to configured recipients (`IVaultCore.distributeSurplus`).
    function distributeSurplus() external nonReentrant whenNotPaused {
        uint256 currentAssets = _insAssets;
        uint256 targetAssets = (protocolTVL * targetRatioBps) / BPS;
        if (currentAssets <= targetAssets) return;

        uint256 surplus = currentAssets - targetAssets;
        if (surplus > accumulatedFees) surplus = accumulatedFees;
        if (surplus == 0) return;

        uint256 treasuryShare = (surplus * treasurySurplusShareBps) / BPS;
        uint256 stakerShare = surplus - treasuryShare;

        if (treasuryShare > 0) {
            usdc.safeTransfer(treasury, treasuryShare);
            _insAssets -= treasuryShare;
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
    function setTreasury(address _treasury) external onlyAdmin {
        if (_treasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
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

    /// @notice Operator-fed reference TVL used for insurance ratio targets (bounded by `maxProtocolTVL`).
    function updateProtocolTVL(uint256 _tvl) external onlyOperator {
        if (_tvl > maxProtocolTVL) revert InvalidTVL();
        uint256 old = protocolTVL;
        protocolTVL = _tvl;
        emit ProtocolTVLUpdated(old, _tvl);
    }

    /// @notice Raise/lower the ceiling for `updateProtocolTVL`.
    function setMaxProtocolTVL(uint256 _maxTVL) external onlyAdmin {
        maxProtocolTVL = _maxTVL;
    }

    /// @notice Clear insurance bad-debt circuit breaker after operational review.
    function resetInsuranceCircuitBreaker() external onlyAdmin {
        insuranceCircuitBreakerActive = false;
        cumulativeBadDebt24h = 0;
        lastBadDebtResetTime = block.timestamp;
        emit InsuranceCircuitBreakerReset(msg.sender);
    }

    /// @notice LP-side assets including borrows and global PnL adjustment from `TradingCore` when available (`IVaultCore.totalAssets`).
    function totalAssets() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLpAssets = _insAssets + accumulatedFees;
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
    function getConservativeTotalAssets() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLpAssets = _insAssets + accumulatedFees;
        uint256 lpBalance = balance > nonLpAssets ? balance - nonLpAssets : 0;
        uint256 total = (lpBalance * DataTypes.DECIMAL_CONVERSION) + (totalBorrowed * DataTypes.DECIMAL_CONVERSION);

        if (tradingCore != address(0)) {
            try ITradingCore(tradingCore).getGlobalUnrealizedPnL() returns (int256 globalPnL) {
                if (globalPnL > 0) {
                    uint256 liability = uint256(globalPnL);
                    return total > liability ? total - liability : 0;
                }
            } catch {
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

    /// @notice USDC available to LP operations (excludes insurance and fee reserves).
    function getAvailableLiquidity() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 nonLpAssets = _insAssets + accumulatedFees;
        return balance > nonLpAssets ? balance - nonLpAssets : 0;
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

    /// @notice Insurance assets divided by `protocolTVL`, scaled by `BPS` (`IVaultCore.getInsuranceHealthRatio`).
    function getInsuranceHealthRatio() public view returns (uint256) {
        return protocolTVL == 0 ? PRECISION : (_insAssets * BPS) / protocolTVL;
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
        uint256 total = totalAssets();
        if (_lpTotalShares == 0 || total == 0) {
            uint256 balance = usdc.balanceOf(address(this));
            uint256 nonLpAssets = _insAssets + accumulatedFees;
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

    function _convertToInsShares(uint256 assets) internal view returns (uint256) {
        return _insTotalShares == 0 || _insAssets == 0 ? assets : (assets * _insTotalShares) / _insAssets;
    }

    function _convertToInsAssets(uint256 shares) internal view returns (uint256) {
        return _insTotalShares == 0 || _insAssets == 0 ? 0 : (shares * _insAssets) / _insTotalShares;
    }

    function _getMaxExposureBps(address market) internal view returns (uint256) {
        uint256 custom = _exposures[market].maxExposurePercent;
        return custom > 0 ? custom : defaultMaxExposureBps;
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {}
}
