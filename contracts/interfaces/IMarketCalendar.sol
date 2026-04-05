// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMarketCalendar {
    struct TradingSession {
        uint16 openTime;
        uint16 closeTime;
    }

    event MarketHoursSet(string indexed marketId, uint16 openTime, uint16 closeTime, int16 timezoneOffset);
    event HolidayAdded(string indexed marketId, uint256 date);
    event HolidayRemoved(string indexed marketId, uint256 date);

    function isMarketOpen(string calldata marketId) external view returns (bool);
    function isMarketOpen(string calldata marketId, uint256 timestamp) external view returns (bool);
    function getNextOpenTime(string calldata marketId, uint256 fromTimestamp) external view returns (uint256);
}
