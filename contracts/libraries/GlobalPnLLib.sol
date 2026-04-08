// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";
import "../interfaces/IOracleAggregator.sol";

/**
 * @title GlobalPnLLib
 * @notice Global unrealized PnL
 */
library GlobalPnLLib {
    function getGlobalUnrealizedPnL(
        address[] storage activeMarkets,
        mapping(address => DataTypes.Market) storage markets,
        address oracleAggregator
    ) external view returns (int256 totalPnL) {
        uint256 len = activeMarkets.length;
        for (uint256 i = 0; i < len; ) {
            address m = activeMarkets[i];
            DataTypes.Market storage market = markets[m];
            if (market.isActive && (market.totalLongSize > 0 || market.totalShortSize > 0)) {
                (uint256 price, , ) = IOracleAggregator(oracleAggregator).getPrice(m);
                if (price > 0) {
                    int256 longPnL = int256((market.totalLongSize * price) / 1e18) - int256(market.totalLongCost);
                    int256 shortPnL = int256(market.totalShortCost) - int256((market.totalShortSize * price) / 1e18);
                    totalPnL += longPnL + shortPnL;
                }
            }
            unchecked {
                ++i;
            }
        }
    }
}
