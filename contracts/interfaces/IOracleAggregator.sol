// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";

/**
 * @title IOracleAggregator
 * @notice Interface for the unified oracle and circuit breaker system
 */
interface IOracleAggregator {
    event PriceUpdated(
        address indexed market, 
        uint256 price, 
        uint256 confidence, 
        uint256 timestamp
    );
    
    event PythFeedSet(address indexed market, bytes32 indexed feedId);
    
    event TWAPUpdated(
        address indexed market, 
        uint256 twapPrice, 
        uint256 windowSeconds
    );
    
    event PriceDeviation(
        address indexed market, 
        uint256 pythPrice, 
        uint256 aggregatedPrice, 
        uint256 deviationBps
    );
    
    event BreakerTriggered(
        address indexed market, 
        DataTypes.BreakerType breakerType, 
        uint256 threshold, 
        uint256 actualValue
    );
    
    event BreakerReset(
        address indexed market, 
        DataTypes.BreakerType breakerType, 
        address resetBy
    );
    
    event EmergencyPauseProposed(
        bytes32 indexed pauseId, 
        address indexed proposer, 
        address[] targets
    );
    
    event EmergencyPauseExecuted(
        bytes32 indexed pauseId, 
        address[] targets
    );
    
    event GlobalPauseActivated(address indexed activator);
    event GlobalPauseDeactivated(address indexed deactivator);

    function getPrice(address market) external view returns (
        uint256 price, 
        uint256 confidence, 
        uint256 timestamp
    );
    
    function getPriceWithConfidence(
        address market, 
        uint256 minConfidence
    ) external view returns (uint256 price);
    
    function getTWAP(
        address market, 
        uint256 windowSeconds
    ) external view returns (uint256 twapPrice);
    
    function getTWAPWithValidation(
        address market, 
        uint256 windowSeconds,
        uint256 minDataPoints
    ) external view returns (uint256 twapPrice, bool isValid);
    
    function getEthUsdPrice() external view returns (uint256 price);
    
    function getValidSourceCount(address market) external view returns (uint256);

    function recordPricePoint(address market, uint256 price) external;

    function checkBreakers(
        address market, 
        uint256 currentPrice, 
        uint256 volume24h
    ) external returns (bool triggered);
    
    function triggerBreaker(
        address market, 
        DataTypes.BreakerType breakerType
    ) external;
    
    function resetBreaker(
        address market, 
        DataTypes.BreakerType breakerType
    ) external;
    
    function autoResetBreakers(address market) external;
    
    function isActionAllowed(
        address market, 
        uint8 actionType
    ) external view returns (bool);
    
    function getBreakerStatus(
        address market, 
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerStatus memory);
    
    function getBreakerConfig(
        address market, 
        DataTypes.BreakerType breakerType
    ) external view returns (DataTypes.BreakerConfig memory);

    function isMarketRestricted(
        address market
    ) external view returns (bool isRestricted, uint256 activeBreakers);

    function proposeEmergencyPause(
        address[] calldata targets, 
        string calldata reason
    ) external returns (bytes32 pauseId);
    
    function confirmEmergencyPause(bytes32 pauseId) external;
    
    function activateGlobalPause() external;
    
    function deactivateGlobalPause() external;
    
    function isGloballyPaused() external view returns (bool);
    
    function proposeEmergencyPrice(
        address market, 
        uint256 price, 
        uint256 validUntil
    ) external returns (bytes32 proposalId);
    
    function confirmEmergencyPrice(bytes32 proposalId) external;

    function setPythFeed(
        address market, 
        bytes32 feedId, 
        uint256 maxStaleness,
        uint64 maxConfidence
    ) external;
    
    function configureBreaker(
        address market, 
        DataTypes.BreakerType breakerType, 
        uint256 threshold, 
        uint256 windowSeconds, 
        uint256 cooldownSeconds
    ) external;
    
    function setBreakerEnabled(
        address market, 
        DataTypes.BreakerType breakerType, 
        bool enabled
    ) external;
    
    function registerPausable(address target) external;
    
    function setGuardianQuorum(uint256 quorum) external;
    
    function addSupportedMarket(address market) external;

    function getOracleConfig(address market) external view returns (
        bytes32 feedId, 
        uint256 maxStaleness, 
        uint256 minPrice, 
        uint256 maxPrice
    );
    
    function isOracleHealthy(address market) external view returns (
        bool healthy, 
        string memory reason
    );
    
    function getHistoricalPrice(
        address market, 
        uint256 hoursAgo
    ) external view returns (uint256);
    
    function getSupportedMarkets() external view returns (address[] memory);
    
    function getPausableList() external view returns (address[] memory);
    
    function getGuardianQuorum() external view returns (uint256);
}
