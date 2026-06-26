// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IDividendManager.sol";

/**
 * @title DividendManager
 * @notice Manages corporate actions (dividends) for RWA markets using a cumulative index model.
 * @dev Longs receive dividends, Shorts pay dividends.
 */
contract DividendManager is Initializable, AccessControlUpgradeable, UUPSUpgradeable, IDividendManager {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant TRADING_CORE_ROLE = keccak256("TRADING_CORE_ROLE");

    error ZeroAddress();
    error IndexDeltaTooLarge();
    error DividendOverflow();
    error DividendTooLarge();
    /// @dev An `amountPerShare` below this floor is almost certainly a
    ///      precision-domain mistake (raw 6-decimal USDC vs 18-decimal per-share).
    ///      Distribute on the canonical 1e18-scaled unit-of-USDC-per-1e18-of-notional
    ///      and reject anything that would silently round down to ~zero.
    error DividendTooSmall();
    /// @dev Raised when cumulative per-market distribution within the current
    ///      rolling window would exceed `maxDividendPerWindow`. Bounds the
    ///      blast radius of a compromised `MANAGER_ROLE`.
    error DividendWindowCapExceeded();
    error InvalidWindowDuration();
    /// @dev 48h UUPS upgrade timelock errors.
    error PendingImplementationMismatch();
    error UpgradeTimelockActive();

    uint256 private constant PRECISION = 1e18;
    /// @notice Minimum `amountPerShare` accepted by `distributeDividend`. With
    ///         positionSize in 1e18-scaled USDC (internal precision) and the
    ///         settlement formula `value = positionSize * indexDelta / 1e18`, a
    ///         `1e6` per-share unit corresponds to a 1 micro-USDC-per-1-USDC-of-
    ///         notional dividend (i.e. 1 ppm). Anything below that is treated as
    ///         a misconfiguration and rejected to avoid silent unit-confusion bugs.
    uint256 public constant MIN_DIVIDEND_PER_SHARE = 1e6;

    mapping(string => uint256) public dividendIndices;
    uint256 public constant MAX_DIVIDEND_PER_SHARE = 1000e18;
    address public tradingCore;

    // ── 48h UUPS upgrade timelock ──
    uint256 private constant UPGRADE_TIMELOCK = 48 hours;
    address private _pendingImpl;
    uint256 private _pendingImplEffective;

    // ── Rolling-window cap on cumulative per-market distribution ──
    /// @notice Length of the rolling window over which `maxDividendPerWindow`
    ///         is enforced (seconds). Default 1 day; admin-tunable.
    uint256 public dividendWindowDuration;
    /// @notice Maximum cumulative `amountPerShare` distributable to a single
    ///         market within one `dividendWindowDuration`. `0` disables the
    ///         cap (used for legacy upgrades that predate this field). Fresh
    ///         deploys default to `MAX_DIVIDEND_PER_SHARE`; operators should
    ///         tighten this to a value matched to expected corporate actions.
    uint256 public maxDividendPerWindow;
    /// @notice marketId → start timestamp of the current accounting window.
    mapping(string => uint256) private _dividendWindowStart;
    /// @notice marketId → cumulative `amountPerShare` distributed in the window.
    mapping(string => uint256) private _dividendWindowCumulative;

    event ImplementationProposed(address indexed pending, uint256 effective);
    event ImplementationCancelled(address indexed pending);
    event DividendLimitsUpdated(uint256 windowDuration, uint256 maxPerWindow);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Lock the implementation contract's initializers so an attacker cannot
        // initialize the logic contract directly and `selfdestruct` it via
        // `upgradeToAndCall`. State lives in the proxy, not here.
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);

        // Defaults: cap cumulative per-market distribution at the per-call
        // maximum over a 1-day rolling window. This bounds a compromised
        // MANAGER_ROLE to one max distribution per market per day instead of
        // unlimited repeats; operators should tighten via `setDividendLimits`.
        dividendWindowDuration = 1 days;
        maxDividendPerWindow = MAX_DIVIDEND_PER_SHARE;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        // 48h staged-implementation timelock. Without this, an admin
        // compromise could swap in a malicious DividendManager that
        // distributes catastrophic dividend amounts and drains shorts.
        if (newImplementation != _pendingImpl) revert PendingImplementationMismatch();
        if (_pendingImplEffective == 0 || block.timestamp < _pendingImplEffective) revert UpgradeTimelockActive();
        delete _pendingImpl;
        delete _pendingImplEffective;
    }

    /// @notice Stage a UUPS upgrade. Effective `UPGRADE_TIMELOCK` later.
    function proposeImplementation(address newImplementation) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newImplementation == address(0)) revert ZeroAddress();
        _pendingImpl = newImplementation;
        _pendingImplEffective = block.timestamp + UPGRADE_TIMELOCK;
        emit ImplementationProposed(newImplementation, _pendingImplEffective);
    }

    /// @notice Cancel a pending UUPS upgrade.
    function cancelPendingImplementation() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit ImplementationCancelled(_pendingImpl);
        delete _pendingImpl;
        delete _pendingImplEffective;
    }

    /// @notice Read-only view of any staged UUPS upgrade.
    function pendingImplementation() external view returns (address pending, uint256 effective) {
        return (_pendingImpl, _pendingImplEffective);
    }

    function setTradingCore(address _tradingCore) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(_tradingCore) == address(0)) revert ZeroAddress();
        address previous = tradingCore;
        if (previous != address(0)) {
            _revokeRole(TRADING_CORE_ROLE, previous);
        }
        tradingCore = _tradingCore;
        _grantRole(TRADING_CORE_ROLE, _tradingCore);
    }

    function distributeDividend(string calldata marketId, uint256 amountPerShare) external onlyRole(MANAGER_ROLE) {
        // Enforce both an upper bound (catastrophic distribution) and a
        // lower bound (unit-confusion). Manager must distribute in canonical 1e18-
        // scaled per-share units.
        if (amountPerShare > MAX_DIVIDEND_PER_SHARE) revert DividendTooLarge();
        if (amountPerShare < MIN_DIVIDEND_PER_SHARE) revert DividendTooSmall();

        // Bound cumulative per-market distribution within a rolling window
        // so a compromised MANAGER_ROLE cannot repeatedly distribute the
        // per-call maximum to drain the vault via long positions. A window cap
        // of 0 disables the check (legacy-upgrade compatibility).
        if (maxDividendPerWindow > 0) {
            uint256 cumulative;
            if (block.timestamp >= _dividendWindowStart[marketId] + dividendWindowDuration) {
                _dividendWindowStart[marketId] = block.timestamp;
                cumulative = amountPerShare;
            } else {
                cumulative = _dividendWindowCumulative[marketId] + amountPerShare;
            }
            if (cumulative > maxDividendPerWindow) revert DividendWindowCapExceeded();
            _dividendWindowCumulative[marketId] = cumulative;
        }

        dividendIndices[marketId] += amountPerShare;
        emit DividendDistributed(marketId, amountPerShare, dividendIndices[marketId], block.timestamp);
    }

    /// @notice Configure the rolling-window distribution cap.
    /// @param windowDuration Window length in seconds (must be non-zero).
    /// @param maxPerWindow Max cumulative `amountPerShare` per market per
    ///        window; `0` disables the cap.
    function setDividendLimits(uint256 windowDuration, uint256 maxPerWindow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (windowDuration == 0) revert InvalidWindowDuration();
        dividendWindowDuration = windowDuration;
        maxDividendPerWindow = maxPerWindow;
        emit DividendLimitsUpdated(windowDuration, maxPerWindow);
    }

    /// @notice Current window accounting for a market: start timestamp and
    ///         cumulative `amountPerShare` distributed in the active window.
    function getDividendWindow(
        string calldata marketId
    ) external view returns (uint256 windowStart, uint256 cumulative) {
        return (_dividendWindowStart[marketId], _dividendWindowCumulative[marketId]);
    }

    function getDividendIndex(string calldata marketId) external view override returns (uint256) {
        return dividendIndices[marketId];
    }

    function settleDividends(
        uint256 positionId,
        string calldata marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastIndex
    ) external override onlyRole(TRADING_CORE_ROLE) returns (int256 dividendAmount, uint256 newIndex) {
        uint256 currentIndex = dividendIndices[marketId];

        // protect against rolling back the per-position dividend pointer.
        if (lastIndex > currentIndex) revert IndexDeltaTooLarge();

        if (currentIndex == lastIndex) {
            return (0, currentIndex);
        }

        uint256 indexDelta = currentIndex - lastIndex;
        if (indexDelta > type(uint128).max) revert IndexDeltaTooLarge();
        if (positionSize > 0 && indexDelta > type(uint256).max / positionSize) revert DividendOverflow();
        uint256 value = (positionSize * indexDelta) / PRECISION;

        if (value > 0) {
            if (isLong) {
                dividendAmount = int256(value);
            } else {
                dividendAmount = -int256(value);
            }
            emit DividendSettled(positionId, dividendAmount, currentIndex);
        }

        return (dividendAmount, currentIndex);
    }

    function getUnsettledDividends(
        string calldata marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastIndex
    ) external view override returns (int256) {
        uint256 currentIndex = dividendIndices[marketId];
        if (currentIndex == lastIndex) return 0;

        uint256 indexDelta = currentIndex - lastIndex;
        if (positionSize > 0 && indexDelta > type(uint256).max / positionSize) return 0;
        uint256 value = (positionSize * indexDelta) / PRECISION;

        if (isLong) return int256(value);
        else return -int256(value);
    }
}
