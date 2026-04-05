// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/FeeCalculator.sol";

/**
 * @title ConfigLib
 * @notice Library for configuration functions
 */
library ConfigLib {
    function setMarket(
        address m,
        address feed,
        uint256 maxLev,
        uint256 maxPos,
        uint256 maxExp,
        uint256 mmBps,
        uint256 imBps,
        uint256 maxStaleness,
        uint256 maxOracleUncertainty,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => bool) storage isMarketActive,
        address[] storage activeMarkets,
        uint256 MAX_ACTIVE_MARKETS
    ) external {
        if (m == address(0) || feed == address(0)) revert InvalidMarket();
        if (markets[m].isListed) revert MarketAlreadyListed();
        if (maxLev > DataTypes.MAX_LEVERAGE_LIMIT) revert ExceedsMaxLeverage();
        if (mmBps < 100 || mmBps > 5000 || imBps < 200 || imBps > 10000 || imBps <= mmBps) revert InvalidMarginConfig();
        markets[m] = DataTypes.Market({chainlinkFeed: feed, maxStaleness: maxStaleness, maxPriceUncertainty: maxOracleUncertainty, maxPositionSize: uint128(maxPos), maxTotalExposure: uint128(maxExp), maintenanceMargin: uint16(mmBps), initialMargin: uint16(imBps), maxLeverage: uint64(maxLev), totalLongSize: 0, totalShortSize: 0, totalLongCost: 0, totalShortCost: 0, isActive: true, isListed: true});
        if (!isMarketActive[m]) {
            if (activeMarkets.length >= MAX_ACTIVE_MARKETS) revert MaxActiveMarketsExceeded();
            activeMarkets.push(m);
            isMarketActive[m] = true;
        }
    }
    
    function updateMarket(
        address m,
        address feed,
        uint256 maxLev,
        uint256 maxPos,
        uint256 maxExp,
        uint256 mmBps,
        uint256 imBps,
        uint256 maxStaleness,
        uint256 maxOracleUncertainty,
        mapping(address => DataTypes.Market) storage markets
    ) external {
        if (m == address(0) || feed == address(0)) revert InvalidMarket();
        if (!markets[m].isListed) revert InvalidMarket();
        if (maxLev > DataTypes.MAX_LEVERAGE_LIMIT) revert ExceedsMaxLeverage();
        if (mmBps < 100 || mmBps > 5000 || imBps < 200 || imBps > 10000 || imBps <= mmBps) revert InvalidMarginConfig();
        markets[m].chainlinkFeed = feed;
        markets[m].maxStaleness = maxStaleness;
        markets[m].maxPriceUncertainty = maxOracleUncertainty;
        markets[m].maxPositionSize = uint128(maxPos);
        markets[m].maxTotalExposure = uint128(maxExp);
        markets[m].maintenanceMargin = uint16(mmBps);
        markets[m].initialMargin = uint16(imBps);
        markets[m].maxLeverage = uint64(maxLev);
    }

    function unlistMarket(
        address m,
        mapping(address => DataTypes.Market) storage markets,
        mapping(address => bool) storage isMarketActive,
        address[] storage activeMarkets
    ) external {
        if (m == address(0) || !markets[m].isListed) revert InvalidMarket();
        markets[m].isActive = false;
        markets[m].isListed = false;
        if (isMarketActive[m]) {
            isMarketActive[m] = false;
            uint256 len = activeMarkets.length;
            for (uint256 i = 0; i < len;) {
                if (activeMarkets[i] == m) {
                    activeMarkets[i] = activeMarkets[len - 1];
                    activeMarkets.pop();
                    break;
                }
                unchecked { ++i; }
            }
        }
    }

    error InvalidMarket();
    error MarketAlreadyListed();
    error ExceedsMaxLeverage();
    error InvalidMarginConfig();
    error MaxActiveMarketsExceeded();
}
