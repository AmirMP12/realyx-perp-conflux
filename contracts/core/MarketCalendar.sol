// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IMarketCalendar.sol";

/**
 * @title MarketCalendar
 * @notice Manages trading hours and holidays for different markets (RWAs)
 */
contract MarketCalendar is 
    Initializable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable, 
    IMarketCalendar 
{
    error InvalidTime();
    error OpenMustBeBeforeClose();
    error InvalidDay();

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    struct MarketConfig {
        uint16 openTime;
        uint16 closeTime;
        int16 timezoneOffset;
        bool exists;
        bool is24x7;
    }

    mapping(string => MarketConfig) public marketConfigs;
    mapping(string => mapping(uint256 => bool)) public holidays;
    mapping(string => mapping(uint8 => bool)) public tradingDays;

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function setMarketConfig(
        string memory marketId,
        uint16 openTime,
        uint16 closeTime,
        int16 timezoneOffset,
        bool is24x7
    ) external onlyRole(MANAGER_ROLE) {
        if (openTime >= 1440 || closeTime >= 1440) revert InvalidTime();
        if (openTime >= closeTime && !is24x7) revert OpenMustBeBeforeClose();

        marketConfigs[marketId] = MarketConfig({
            openTime: openTime,
            closeTime: closeTime,
            timezoneOffset: timezoneOffset,
            exists: true,
            is24x7: is24x7
        });

        if (!is24x7) {
            for (uint8 i = 1; i <= 5; i++) {
                tradingDays[marketId][i] = true;
            }
            tradingDays[marketId][0] = false;
            tradingDays[marketId][6] = false;
        } else {
            for (uint8 i = 0; i <= 6; i++) {
                tradingDays[marketId][i] = true;
            }
        }

        emit MarketHoursSet(marketId, openTime, closeTime, timezoneOffset);
    }

    function setTradingDay(string memory marketId, uint8 dayOfWeek, bool isOpen) external onlyRole(MANAGER_ROLE) {
        if (dayOfWeek > 6) revert InvalidDay();
        tradingDays[marketId][dayOfWeek] = isOpen;
    }

    function setHoliday(string memory marketId, uint256 dateYYYYMMDD, bool isHoliday) external onlyRole(MANAGER_ROLE) {
        holidays[marketId][dateYYYYMMDD] = isHoliday;
        if (isHoliday) emit HolidayAdded(marketId, dateYYYYMMDD);
        else emit HolidayRemoved(marketId, dateYYYYMMDD);
    }

    function isMarketOpen(string calldata marketId) external view override returns (bool) {
        return isMarketOpen(marketId, block.timestamp);
    }

    function isMarketOpen(string calldata marketId, uint256 timestamp) public view override returns (bool) {
        MarketConfig memory config = marketConfigs[marketId];
        if (!config.exists) return true;
        if (config.is24x7) return true;

        int256 adjustedTime = int256(timestamp) + (int256(config.timezoneOffset) * 60);
        if (adjustedTime < 0) return false;
        uint256 localTs = uint256(adjustedTime);

        uint256 daysSinceEpoch = localTs / 86400;
        uint8 dayOfWeek = uint8((daysSinceEpoch + 4) % 7);

        if (!tradingDays[marketId][dayOfWeek]) return false;

        uint256 date = _timestampToDate(localTs);
        if (holidays[marketId][date]) return false;

        uint256 secondsOfDay = localTs % 86400;
        uint256 minutesOfDay = secondsOfDay / 60;

        return minutesOfDay >= config.openTime && minutesOfDay < config.closeTime;
    }

    function _timestampToDate(uint256 timestamp) internal pure returns (uint256) {
        uint256 z = timestamp / 86400 + 719468;
        uint256 era = (z >= 0 ? z : z - 146096) / 146097;
        uint256 doe = uint256(int256(z) - int256(era * 146097));
        uint256 yoe = (doe - doe/1460 + doe/36524 - doe/146096) / 365;
        uint256 y = uint256(int256(yoe) + int256(era * 400));
        uint256 doy = doe - (365*yoe + yoe/4 - yoe/100);
        uint256 mp = (5*doy + 2)/153;
        uint256 d = doy - (153*mp + 2)/5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        uint256 effectiveYear = m <= 2 ? y + 1 : y;
        
        return effectiveYear * 10000 + m * 100 + d;
    }

    function getNextOpenTime(string calldata marketId, uint256 fromTimestamp) external view override returns (uint256) {
        MarketConfig memory config = marketConfigs[marketId];
        if (!config.exists || config.is24x7) return fromTimestamp;

        int256 offsetSeconds = int256(config.timezoneOffset) * 60;
        int256 adjusted = int256(fromTimestamp) + offsetSeconds;
        if (adjusted < 0) return fromTimestamp;
        uint256 localTs = uint256(adjusted);
        uint256 maxIterations = 366;

        for (uint256 iterations = 0; iterations < maxIterations; iterations++) {
            uint256 daysSinceEpoch = localTs / 86400;
            uint8 dayOfWeek = uint8((daysSinceEpoch + 4) % 7);
            uint256 date = _timestampToDate(localTs);
            uint256 secondsOfDay = localTs % 86400;
            uint256 minutesOfDay = secondsOfDay / 60;
            uint256 openSecondsToday = uint256(config.openTime) * 60;
            uint256 closeSecondsToday = uint256(config.closeTime) * 60;

            if (!tradingDays[marketId][dayOfWeek] || holidays[marketId][date]) {
                localTs = ((localTs / 86400) + 1) * 86400;
                continue;
            }
            if (minutesOfDay < config.openTime) {
                uint256 localOpen = (localTs / 86400) * 86400 + openSecondsToday;
                return uint256(int256(localOpen) - offsetSeconds);
            }
            if (secondsOfDay >= openSecondsToday && secondsOfDay < closeSecondsToday) {
                return fromTimestamp;
            }
            localTs = ((localTs / 86400) + 1) * 86400;
        }
        return 0;
    }
}
