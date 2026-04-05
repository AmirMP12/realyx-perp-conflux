// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";

/**
 * @title OracleAggregatorLib
 * @notice Library for oracle aggregation calculations and circuit breaker logic
 */
library OracleAggregatorLib {
    uint256 internal constant PRECISION = 1e18;
    uint256 internal constant BPS = 10000;
    uint256 internal constant TWAP_BUFFER_SIZE = 48;
    uint256 internal constant MAX_WINDOW_HOURS = 24;
    uint256 internal constant MIN_TWAP_DATA_POINTS = 6;

    error NoValidPrice();
    error InsufficientTWAPData();
    error TWAPOverflow();

    /**
     * @notice Calculate weighted average of values
     * @param values Array of price values
     * @param weights Array of corresponding weights
     * @return Weighted average
     */
    function calculateWeightedAverage(
        uint256[] memory values, 
        uint256[] memory weights
    ) internal pure returns (uint256) {
        uint256 len = values.length;
        if (len == 0) return 0;
        if (len == 1) return values[0];
        
        uint256 weightedSum;
        uint256 totalWeight;
        for (uint256 i = 0; i < len;) {
            if (values[i] > 0) { 
                weightedSum += values[i] * weights[i]; 
                totalWeight += weights[i];
            }
            unchecked { ++i; }
        }
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
    
    /**
     * @notice Calculate deviation between two values in basis points
     * @param a First value
     * @param b Second value (base)
     * @return Deviation in BPS
     */
    function calculateDeviation(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) return BPS;
        return a > b ? ((a - b) * BPS) / b : ((b - a) * BPS) / b;
    }
    
    /**
     * @notice Compute aggregated price from multiple sources with deviation filtering
     * @param prices Array of prices from different sources
     * @param weights Array of corresponding weights
     * @param maxDeviationBps Maximum allowed deviation in BPS
     * @return aggregatedPrice The weighted average price
     * @return validCount Number of valid price sources
     * @return totalWeight Total weight of valid sources
     */
    function computeAggregatedPrice(
        uint256[] calldata prices, 
        uint256[] calldata weights,
        uint256 maxDeviationBps
    ) internal pure returns (uint256 aggregatedPrice, uint256 validCount, uint256 totalWeight) {
        uint256 avgPrice = _calculateSimpleWeightedAverage(prices, weights);
        uint256 weightedSum;
        
        for (uint256 i = 0; i < prices.length;) {
            if (prices[i] > 0 && calculateDeviation(prices[i], avgPrice) <= maxDeviationBps) {
                weightedSum += prices[i] * weights[i];
                totalWeight += weights[i];
                unchecked { ++validCount; }
            }
            unchecked { ++i; }
        }
        
        aggregatedPrice = totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
    
    /**
     * @notice Calculate time-weighted average price (TWAP) from price points buffer.
     * @dev Uses time within the window as weight: more recent points have higher weight.
     * @param points Array of price points
     * @param head Current head position in buffer
     * @param count Number of valid entries in buffer
     * @param windowSeconds Time window for TWAP calculation
     * @param currentTimestamp Current block timestamp
     * @return twapPrice Time-weighted average price
     */
    function calculateTWAP(
        DataTypes.PricePoint[48] storage points,
        uint256 head,
        uint256 count,
        uint256 windowSeconds,
        uint256 currentTimestamp
    ) internal view returns (uint256 twapPrice) {
        if (count == 0) revert NoValidPrice();
        
        uint256 cutoffTime = currentTimestamp > windowSeconds ? currentTimestamp - windowSeconds : 0;
        uint256 totalWeight;
        uint256 weightedSum;
        uint256 maxSafePrice = type(uint128).max;
        
        for (uint256 i = 0; i < count;) {
            uint256 idx = (head + TWAP_BUFFER_SIZE - 1 - i) % TWAP_BUFFER_SIZE;
            DataTypes.PricePoint storage point = points[idx];
            if (point.timestamp < cutoffTime) break;
            
            uint256 price = uint256(point.price);
            uint256 timeWeight = point.timestamp > cutoffTime ? (point.timestamp - cutoffTime) * PRECISION / windowSeconds : 0;
            uint256 weight = timeWeight;
            
            if (price > maxSafePrice) price = maxSafePrice;
            
            uint256 contribution = price * weight;
            if (weightedSum + contribution < weightedSum) revert TWAPOverflow();
            weightedSum += contribution;
            totalWeight += weight;
            unchecked { ++i; }
        }
        
        if (totalWeight == 0) revert NoValidPrice();
        twapPrice = weightedSum / totalWeight;
    }
    
    /**
     * @notice Calculate confidence-weighted average price from buffer; returns data point count for validation.
     * @dev Uses point.confidence as weight (not time). Use when minimum data points matter (e.g. TWAP validity checks).
     * @return twapPrice Confidence-weighted average price
     * @return dataPointCount Number of data points used
     */
    function calculateTWAPWithCount(
        DataTypes.PricePoint[48] storage points,
        uint256 head,
        uint256 count,
        uint256 windowSeconds,
        uint256 currentTimestamp
    ) internal view returns (uint256 twapPrice, uint256 dataPointCount) {
        if (count == 0) revert NoValidPrice();
        
        uint256 cutoffTime = currentTimestamp > windowSeconds ? currentTimestamp - windowSeconds : 0;
        uint256 totalWeight;
        uint256 weightedSum;
        uint256 maxSafePrice = type(uint128).max;
        
        for (uint256 i = 0; i < count;) {
            uint256 idx = (head + TWAP_BUFFER_SIZE - 1 - i) % TWAP_BUFFER_SIZE;
            DataTypes.PricePoint storage point = points[idx];
            if (point.timestamp < cutoffTime) break;
            
            uint256 price = uint256(point.price);
            
            // Inverse variance weighting: lower uncertainty gets exponentially higher weight
            // Scaled by PRECISION * PRECISION to prevent integer underflow with high prices
            uint256 uncertainty = uint256(point.confidence);
            uint256 weight = (PRECISION * PRECISION) / (uncertainty + 1);
            
            if (price > maxSafePrice) price = maxSafePrice;
            
            uint256 contribution = price * weight;
            if (weightedSum + contribution < weightedSum) revert TWAPOverflow();
            weightedSum += contribution;
            totalWeight += weight;
            unchecked { 
                ++i;
                ++dataPointCount;
            }
        }
        
        if (totalWeight == 0) revert NoValidPrice();
        twapPrice = weightedSum / totalWeight;
    }
    
    /**
     * @notice Check if price drop breaker should trigger
     * @param currentPrice Current price
     * @param pastPrice Historical price to compare
     * @param threshold Threshold in BPS
     * @return triggered Whether breaker should trigger
     * @return dropBps Actual drop in BPS
     */
    function checkPriceDropTriggered(
        uint256 currentPrice,
        uint256 pastPrice,
        uint256 threshold
    ) internal pure returns (bool triggered, uint256 dropBps) {
        if (pastPrice == 0 || currentPrice >= pastPrice) return (false, 0);
        
        dropBps = ((pastPrice - currentPrice) * BPS) / pastPrice;
        triggered = dropBps >= threshold;
    }
    
    /**
     * @notice Check if volume spike breaker should trigger
     * @param volume24h Current 24h volume
     * @param avgVolume Average historical volume
     * @param threshold Threshold multiplier (in %)
     * @return triggered Whether breaker should trigger
     * @return multiplier Actual volume multiplier (in %)
     */
    function checkVolumeSpikeTriggered(
        uint256 volume24h,
        uint256 avgVolume,
        uint256 threshold
    ) internal pure returns (bool triggered, uint256 multiplier) {
        if (avgVolume == 0) return (false, 0);
        
        multiplier = (volume24h * 100) / avgVolume;
        triggered = multiplier >= threshold;
    }
    
    /**
     * @notice Check if TWAP deviation breaker should trigger
     * @param currentPrice Current price
     * @param twapPrice TWAP price
     * @param threshold Threshold in BPS
     * @return triggered Whether breaker should trigger
     * @return deviation Actual deviation in BPS
     */
    function checkTWAPDeviationTriggered(
        uint256 currentPrice,
        uint256 twapPrice,
        uint256 threshold
    ) internal pure returns (bool triggered, uint256 deviation) {
        if (twapPrice == 0) return (false, 0);
        
        deviation = currentPrice > twapPrice 
            ? ((currentPrice - twapPrice) * BPS) / twapPrice 
            : ((twapPrice - currentPrice) * BPS) / twapPrice;
        triggered = deviation >= threshold;
    }
    
    /**
     * @notice Normalize Chainlink price to 18 decimals
     * @param answer Raw price from Chainlink
     * @param feedDecimals Decimals of the Chainlink feed
     * @return Normalized price with 18 decimals
     */
    function normalizeChainlinkPrice(int256 answer, uint8 feedDecimals) internal pure returns (uint256) {
        if (answer <= 0) return 0;
        
        if (feedDecimals < 18) {
            return uint256(answer) * (10 ** (18 - feedDecimals));
        } else if (feedDecimals > 18) {
            return uint256(answer) / (10 ** (feedDecimals - 18));
        } else {
            return uint256(answer);
        }
    }
    
    /**
     * @notice Calculate simple TWAP from buffer (no weights)
     */
    function calculateSimpleTWAP(
        DataTypes.PricePoint[48] storage points,
        uint256 head,
        uint256 count
    ) internal view returns (uint256) {
        if (count == 0) return 0;
        uint256 sum;
        for (uint256 i = 0; i < count;) {
            sum += uint256(points[(head + TWAP_BUFFER_SIZE - 1 - i) % TWAP_BUFFER_SIZE].price);
            unchecked { ++i; }
        }
        return sum / count;
    }

    function _calculateSimpleWeightedAverage(
        uint256[] calldata values, 
        uint256[] calldata weights
    ) private pure returns (uint256) {
        uint256 len = values.length;
        if (len == 0) return 0;
        
        uint256 weightedSum;
        uint256 totalWeight;
        for (uint256 i = 0; i < len;) {
            if (values[i] > 0) { 
                weightedSum += values[i] * weights[i]; 
                totalWeight += weights[i];
            }
            unchecked { ++i; }
        }
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
}
