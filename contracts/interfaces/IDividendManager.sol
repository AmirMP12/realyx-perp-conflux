// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDividendManager {
    event DividendDistributed(string indexed marketId, uint256 amountPerShare, uint256 newIndex, uint256 timestamp);
    event DividendSettled(uint256 indexed positionId, int256 amount, uint256 newIndex);
    
    function distributeDividend(string calldata marketId, uint256 amountPerShare) external;
    function getDividendIndex(string calldata marketId) external view returns (uint256);
    function settleDividends(uint256 positionId, string calldata marketId, uint256 positionSize, bool isLong, uint256 lastIndex) external returns (int256 dividendAmount, uint256 newIndex);
    function getUnsettledDividends(string calldata marketId, uint256 positionSize, bool isLong, uint256 lastIndex) external view returns (int256);
}
