// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../interfaces/IDividendManager.sol";

/**
 * @title DividendSettlementLib
 * @notice Library for dividend settlement logic
 */
library DividendSettlementLib {
    function settleDividends(
        uint256 positionId,
        DataTypes.Position storage position,
        string memory marketId,
        uint256 currentIndex,
        IDividendManager dividendManager
    ) external returns (int256 divAmount, uint256 newIndex) {
        if (address(dividendManager) == address(0) || bytes(marketId).length == 0) return (0, currentIndex);
        (divAmount, newIndex) = dividendManager.settleDividends(positionId, marketId, uint256(position.size), DataTypes.isLong(position.flags), currentIndex);
    }
}
