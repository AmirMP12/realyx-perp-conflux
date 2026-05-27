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

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

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

        dividendIndices[marketId] += amountPerShare;
        emit DividendDistributed(marketId, amountPerShare, dividendIndices[marketId], block.timestamp);
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
