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
contract DividendManager is 
    Initializable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable, 
    IDividendManager 
{
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant TRADING_CORE_ROLE = keccak256("TRADING_CORE_ROLE");

    error ZeroAddress();
    error IndexDeltaTooLarge();
    error DividendOverflow();
    error DividendTooLarge();
    
    uint256 private constant PRECISION = 1e18;

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
        if (amountPerShare > MAX_DIVIDEND_PER_SHARE) revert DividendTooLarge();

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
