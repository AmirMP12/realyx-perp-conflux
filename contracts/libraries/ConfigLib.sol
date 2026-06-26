// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/FeeCalculator.sol";
import "../libraries/PositionMath.sol";

/**
 * @title ConfigLib
 * @notice Library for configuration functions
 */
library ConfigLib {
    /// @notice Emitted when a market is listed or its parameters are updated.
    event MarketUpdated(address indexed market, uint256 maxLeverage, uint256 maxPositionSize, uint256 maxTotalExposure);

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
        uint256 MAX_ACTIVE_MARKETS,
        mapping(address => DataTypes.FundingState) storage fundingStates
    ) external {
        if (m == address(0) || feed == address(0)) revert InvalidMarket();
        if (markets[m].isListed) revert MarketAlreadyListed();
        if (maxLev == 0 || maxLev > DataTypes.MAX_LEVERAGE_LIMIT) revert ExceedsMaxLeverage();
        // Margin-config bounds. `imBps` is the per-position initial-margin floor,
        // so the maximum leverage actually reachable on this market is
        // `min(maxLev, BPS_PRECISION / imBps)`. To allow markets to be
        // configured up to `MAX_LEVERAGE_LIMIT` (100x) the `imBps` floor is 100
        // (1% margin → 100x). `mmBps` (per-market maintenance bps) must stay
        // strictly below `imBps` so a freshly-opened position is never
        // liquidatable at entry. Core liquidation uses the dynamic maintenance
        // curve (`PositionMath.calculateDynamicMaintenanceMargin`) which is
        // additionally capped to 50% of the initial margin, so positions open
        // with a healthy buffer at every leverage in `[1, maxLev]`.
        if (mmBps < 50 || mmBps > 5000 || imBps < 100 || imBps > 10000 || imBps <= mmBps) revert InvalidMarginConfig();
        markets[m] = DataTypes.Market({
            chainlinkFeed: feed,
            maxStaleness: maxStaleness,
            maxPriceUncertainty: maxOracleUncertainty,
            maxPositionSize: uint128(maxPos),
            maxTotalExposure: uint128(maxExp),
            maintenanceMargin: uint16(mmBps),
            initialMargin: uint16(imBps),
            maxLeverage: uint64(maxLev),
            totalLongSize: 0,
            totalShortSize: 0,
            totalLongCost: 0,
            totalShortCost: 0,
            isActive: true,
            isListed: true
        });
        if (!isMarketActive[m]) {
            if (activeMarkets.length >= MAX_ACTIVE_MARKETS) revert MaxActiveMarketsExceeded();
            activeMarkets.push(m);
            isMarketActive[m] = true;
        }
        // Initialize funding clock to listing time so first settlement does not back-charge from epoch.
        if (fundingStates[m].lastSettlement == 0) {
            fundingStates[m].lastSettlement = uint64(block.timestamp);
        }
        emit MarketUpdated(m, maxLev, maxPos, maxExp);
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
        if (maxLev == 0 || maxLev > DataTypes.MAX_LEVERAGE_LIMIT) revert ExceedsMaxLeverage();
        // See `setMarket` for the rationale behind these bounds: `imBps >= 100`
        // permits configuring up to 100x; `mmBps < imBps` keeps fresh positions
        // out of liquidation at entry.
        if (mmBps < 50 || mmBps > 5000 || imBps < 100 || imBps > 10000 || imBps <= mmBps) revert InvalidMarginConfig();
        markets[m].chainlinkFeed = feed;
        markets[m].maxStaleness = maxStaleness;
        markets[m].maxPriceUncertainty = maxOracleUncertainty;
        markets[m].maxPositionSize = uint128(maxPos);
        markets[m].maxTotalExposure = uint128(maxExp);
        markets[m].maintenanceMargin = uint16(mmBps);
        markets[m].initialMargin = uint16(imBps);
        markets[m].maxLeverage = uint64(maxLev);
        emit MarketUpdated(m, maxLev, maxPos, maxExp);
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
            for (uint256 i = 0; i < len; ) {
                if (activeMarkets[i] == m) {
                    activeMarkets[i] = activeMarkets[len - 1];
                    activeMarkets.pop();
                    break;
                }
                unchecked {
                    ++i;
                }
            }
        }
    }

    error InvalidMarket();
    error MarketAlreadyListed();
    error ExceedsMaxLeverage();
    error InvalidMarginConfig();
    error MaxActiveMarketsExceeded();
}
