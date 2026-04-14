// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IDividendManager
 * @notice Market-level dividend index for adjusting perpetual PnL when underlying RWAs pay distributions.
 * @dev Indices are per `marketId` string; `TradingCore` supplies position size and last settled index.
 */
interface IDividendManager {
    event DividendDistributed(string indexed marketId, uint256 amountPerShare, uint256 newIndex, uint256 timestamp);
    event DividendSettled(uint256 indexed positionId, int256 amount, uint256 newIndex);

    /**
     * @notice Accrue a dividend into the global index for `marketId` (operator / governance gated on implementation).
     * @param marketId Calendar/market string id.
     * @param amountPerShare Increment to the cumulative dividend index per unit position size.
     */
    function distributeDividend(string calldata marketId, uint256 amountPerShare) external;

    /**
     * @notice Latest cumulative dividend index for `marketId`.
     */
    function getDividendIndex(string calldata marketId) external view returns (uint256);

    /**
     * @notice Apply dividend accrual between `lastIndex` and the current global index for a position leg.
     * @param positionId Position being settled.
     * @param marketId Market string id.
     * @param positionSize Internal size units used by `TradingCore`.
     * @param isLong Direction affects sign of cashflow in the implementation.
     * @param lastIndex Last index credited on the position.
     * @return dividendAmount Signed cashflow owed to or from the trader for this step.
     * @return newIndex Updated last-settled index stored by the caller.
     */
    function settleDividends(
        uint256 positionId,
        string calldata marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastIndex
    ) external returns (int256 dividendAmount, uint256 newIndex);

    /**
     * @notice Preview unsettled dividend cashflow without mutating state.
     * @param marketId Market string id.
     * @param positionSize Internal size units.
     * @param isLong Long/short direction.
     * @param lastIndex Last settled index on the position.
     */
    function getUnsettledDividends(
        string calldata marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastIndex
    ) external view returns (int256);
}
