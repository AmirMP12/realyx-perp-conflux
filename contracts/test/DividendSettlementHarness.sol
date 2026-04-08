// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";
import "../libraries/DividendSettlementLib.sol";
import "../interfaces/IDividendManager.sol";

contract DividendSettlementHarness {
    DataTypes.Position private _pos;

    function setPosition(uint128 size, uint8 flags) external {
        _pos.size = size;
        _pos.flags = flags;
        _pos.state = DataTypes.PosStatus.OPEN;
    }

    function settle(
        uint256 positionId,
        string calldata marketId,
        uint256 currentIndex,
        IDividendManager manager
    ) external returns (int256 divAmount, uint256 newIndex) {
        return DividendSettlementLib.settleDividends(positionId, _pos, marketId, currentIndex, manager);
    }
}

contract MockDividendManagerForSettlement is IDividendManager {
    int256 public retAmount;
    uint256 public retIndex;
    bool public shouldRevert;

    function configure(int256 amount, uint256 index, bool revertFlag) external {
        retAmount = amount;
        retIndex = index;
        shouldRevert = revertFlag;
    }

    function settleDividends(
        uint256,
        string calldata,
        uint256,
        bool,
        uint256
    ) external view override returns (int256 dividendAmount, uint256 newIndex) {
        if (shouldRevert) revert("mock revert");
        return (retAmount, retIndex);
    }

    function distributeDividend(string calldata, uint256) external pure override {}
    function getDividendIndex(string calldata) external pure override returns (uint256) {
        return 0;
    }
    function getUnsettledDividends(string calldata, uint256, bool, uint256) external pure override returns (int256) {
        return 0;
    }
}
