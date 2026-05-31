// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "../interfaces/IOracleAggregator.sol";

/**
 * @title GlobalPnLLib
 * @notice Global unrealized PnL aggregation across all active markets.
 * @dev Hardened against int256 overflow on extreme OI×price products.
 *      Markets whose individual product would overflow are skipped (i.e.
 *      reported as zero PnL contribution); a position cap upstream is
 *      the proper fix, this is defense in depth so that a single
 *      malformed market never bricks `vault.totalAssets()` valuation.
 */
library GlobalPnLLib {
    function getGlobalUnrealizedPnL(
        address[] storage activeMarkets,
        mapping(address => DataTypes.Market) storage markets,
        address oracleAggregator
    ) external view returns (int256 totalPnL) {
        uint256 maxSafe = uint256(type(int256).max) / 2;
        uint256 len = activeMarkets.length;
        for (uint256 i = 0; i < len; ) {
            address m = activeMarkets[i];
            DataTypes.Market storage market = markets[m];
            if (market.isActive && (market.totalLongSize > 0 || market.totalShortSize > 0)) {
                // Per-market fault isolation: a single unreadable feed must not
                // revert the whole aggregation (mirrors TradingCoreViews).
                try IOracleAggregator(oracleAggregator).getPrice(m) returns (uint256 price, uint256, uint256) {
                    if (price > 0) {
                        uint256 longCurrent = (market.totalLongSize * price) / 1e18;
                        uint256 shortCurrent = (market.totalShortSize * price) / 1e18;
                        if (
                            longCurrent <= maxSafe &&
                            shortCurrent <= maxSafe &&
                            market.totalLongCost <= maxSafe &&
                            market.totalShortCost <= maxSafe
                        ) {
                            int256 longPnL = int256(longCurrent) - int256(market.totalLongCost);
                            int256 shortPnL = int256(market.totalShortCost) - int256(shortCurrent);
                            totalPnL += longPnL + shortPnL;
                        }
                    }
                } catch {
                    // skip unreadable market
                }
            }
            unchecked {
                ++i;
            }
        }
    }
}
