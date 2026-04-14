// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IMarketCalendar
 * @notice Trading-hour and holiday scheduling for TradFi-style markets keyed by string ids.
 * @dev `marketId` strings are configured off-chain / by operators and matched to oracle `market` addresses in `TradingCore`.
 */
interface IMarketCalendar {
    struct TradingSession {
        uint16 openTime;
        uint16 closeTime;
    }

    event MarketHoursSet(string indexed marketId, uint16 openTime, uint16 closeTime, int16 timezoneOffset);
    event HolidayAdded(string indexed marketId, uint256 date);
    event HolidayRemoved(string indexed marketId, uint256 date);

    /**
     * @notice Whether `marketId` is considered open at `block.timestamp`.
     * @param marketId Logical market identifier (e.g. equity ticker id).
     */
    function isMarketOpen(string calldata marketId) external view returns (bool);

    /**
     * @notice Whether `marketId` is open at a specific `timestamp` (seconds).
     * @param marketId Logical market identifier.
     * @param timestamp Unix time to evaluate.
     */
    function isMarketOpen(string calldata marketId, uint256 timestamp) external view returns (bool);

    /**
     * @notice Next session open boundary at or after `fromTimestamp`.
     * @param marketId Logical market identifier.
     * @param fromTimestamp Starting instant for the search.
     * @return openTime Unix timestamp of next open (implementation-defined; `0` if none).
     */
    function getNextOpenTime(string calldata marketId, uint256 fromTimestamp) external view returns (uint256);
}
