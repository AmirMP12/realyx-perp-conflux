// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";

/**
 * @title CircuitBreakerLib
 * @notice Library for circuit breaker operations
 */
library CircuitBreakerLib {
    uint256 private constant BPS = 10000;
    
    error BreakerNotConfigured();
    error BreakerAlreadyTriggered();
    error BreakerNotTriggered();
    error CooldownActive();
    error InvalidWindowSeconds();
    error InvalidCooldownSeconds();
    
    event BreakerTriggered(address indexed collection, DataTypes.BreakerType breakerType, uint256 threshold, uint256 price);
    event BreakerReset(address indexed collection, DataTypes.BreakerType breakerType, address indexed resetBy);
    event BreakerResetByAdmin(address indexed collection, DataTypes.BreakerType breakerType, address indexed resetBy);
    
    function checkPriceDropBreaker(
        address collection,
        uint256 currentPrice,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) storage breakerConfigs,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses,
        mapping(address => mapping(uint256 => uint256)) storage historicalPrices
    ) external returns (bool) {
        return _checkPriceDropBreaker(collection, currentPrice, breakerConfigs, breakerStatuses, historicalPrices);
    }
    
    function checkTWAPDeviationBreaker(
        address collection,
        uint256 currentPrice,
        uint256 twap,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) storage breakerConfigs,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses
    ) external returns (bool) {
        return _checkTWAPDeviationBreaker(collection, currentPrice, twap, breakerConfigs, breakerStatuses);
    }
    
    function triggerBreaker(
        address collection,
        DataTypes.BreakerType breakerType,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) storage breakerConfigs,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses
    ) external {
        DataTypes.BreakerConfig storage config = breakerConfigs[collection][breakerType];
        if (!config.enabled) revert BreakerNotConfigured();
        
        DataTypes.BreakerStatus storage status = breakerStatuses[collection][breakerType];
        if (status.state == DataTypes.BreakerState.TRIGGERED) revert BreakerAlreadyTriggered();
        
        status.state = DataTypes.BreakerState.TRIGGERED;
        status.triggeredAt = block.timestamp;
        status.resetAt = block.timestamp + config.cooldownSeconds;
        status.triggeredBy = msg.sender;
        
        emit BreakerTriggered(collection, breakerType, config.threshold, 0);
    }
    
    function resetBreaker(
        address collection,
        DataTypes.BreakerType breakerType,
        bool isAdmin,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses
    ) external {
        DataTypes.BreakerStatus storage status = breakerStatuses[collection][breakerType];
        if (status.state == DataTypes.BreakerState.INACTIVE) {
            revert BreakerNotTriggered();
        }
        if (block.timestamp < status.resetAt && !isAdmin) {
            revert CooldownActive();
        }
        if (isAdmin && block.timestamp < status.resetAt) {
            emit BreakerResetByAdmin(collection, breakerType, msg.sender);
        }
        status.state = DataTypes.BreakerState.INACTIVE;
        status.triggeredAt = 0;
        status.resetAt = 0;
        status.triggeredBy = address(0);
        
        emit BreakerReset(collection, breakerType, msg.sender);
    }
    
    function autoResetBreakers(
        address collection,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses
    ) external {
        uint8 breakerTypeCount = uint8(DataTypes.BreakerType.EMERGENCY) + 1;
        for (uint8 i = 0; i < breakerTypeCount;) {
            DataTypes.BreakerType breakerType = DataTypes.BreakerType(i);
            DataTypes.BreakerStatus storage status = breakerStatuses[collection][breakerType];
            
            if (status.state == DataTypes.BreakerState.TRIGGERED && block.timestamp >= status.resetAt) {
                status.state = DataTypes.BreakerState.INACTIVE;
                status.triggeredAt = 0;
                status.resetAt = 0;
                status.triggeredBy = address(0);
                emit BreakerReset(collection, breakerType, address(0));
            }
            unchecked { ++i; }
        }
    }
    
    function configureBreaker(
        address collection,
        DataTypes.BreakerType breakerType,
        uint256 threshold,
        uint256 windowSeconds,
        uint256 cooldownSeconds,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) storage breakerConfigs
    ) external {
        if (windowSeconds == 0) revert InvalidWindowSeconds();
        if (cooldownSeconds == 0) revert InvalidCooldownSeconds();
        
        breakerConfigs[collection][breakerType] = DataTypes.BreakerConfig({
            breakerType: breakerType,
            threshold: threshold,
            windowSeconds: windowSeconds,
            cooldownSeconds: cooldownSeconds,
            enabled: true
        });
    }
    
    function isActionAllowed(
        address collection,
        uint8 actionType,
        bool globalPause,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses
    ) external view returns (bool) {
        if (globalPause) return false;
        for (uint8 i = 0; i <= uint8(DataTypes.BreakerType.EMERGENCY);) {
            DataTypes.BreakerStatus storage status = breakerStatuses[collection][DataTypes.BreakerType(i)];
            if (status.state == DataTypes.BreakerState.TRIGGERED) {
                if (DataTypes.BreakerType(i) == DataTypes.BreakerType.EMERGENCY) return false;
                if (actionType == 0) return false;
            }
            unchecked { ++i; }
        }
        return true;
    }
    
    function _checkPriceDropBreaker(
        address collection,
        uint256 currentPrice,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) storage breakerConfigs,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses,
        mapping(address => mapping(uint256 => uint256)) storage historicalPrices
    ) private returns (bool) {
        DataTypes.BreakerConfig memory config = breakerConfigs[collection][DataTypes.BreakerType.PRICE_DROP];
        if (!config.enabled) return false;
        
        uint256 currentBucket = block.timestamp / 5 minutes;
        uint256 prevBucket = currentBucket > 0 ? currentBucket - 1 : 0;
        
        uint256 refPrice = historicalPrices[collection][prevBucket];
        
        if (refPrice == 0) return false;
        
        if (currentPrice < refPrice) {
            uint256 drop = refPrice - currentPrice;
            uint256 dropBps = (drop * BPS) / refPrice;
            
            if (dropBps > config.threshold) {
                _triggerInternal(collection, DataTypes.BreakerType.PRICE_DROP, currentPrice, breakerConfigs, breakerStatuses);
                return true;
            }
        }
        return false;
    }
    
    function _checkTWAPDeviationBreaker(
        address collection,
        uint256 currentPrice,
        uint256 twap,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) storage breakerConfigs,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses
    ) private returns (bool) {
        DataTypes.BreakerConfig memory config = breakerConfigs[collection][DataTypes.BreakerType.TWAP_DEVIATION];
        if (!config.enabled) return false;
        if (twap == 0) return false;
        
        uint256 delta = currentPrice > twap ? currentPrice - twap : twap - currentPrice;
        uint256 devBps = (delta * BPS) / twap;
        
        if (devBps > config.threshold) {
            _triggerInternal(collection, DataTypes.BreakerType.TWAP_DEVIATION, currentPrice, breakerConfigs, breakerStatuses);
            return true;
        }
        return false;
    }
    
    function _triggerInternal(
        address collection,
        DataTypes.BreakerType bType,
        uint256 price,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerConfig)) storage breakerConfigs,
        mapping(address => mapping(DataTypes.BreakerType => DataTypes.BreakerStatus)) storage breakerStatuses
    ) private {
        DataTypes.BreakerStatus storage status = breakerStatuses[collection][bType];
        DataTypes.BreakerConfig storage config = breakerConfigs[collection][bType];
        
        if (status.state != DataTypes.BreakerState.TRIGGERED) {
            status.state = DataTypes.BreakerState.TRIGGERED;
            status.triggeredAt = block.timestamp;
            status.resetAt = block.timestamp + config.cooldownSeconds;
            status.triggeredBy = address(this);
            
            emit BreakerTriggered(collection, bType, config.threshold, price);
        }
    }
}
