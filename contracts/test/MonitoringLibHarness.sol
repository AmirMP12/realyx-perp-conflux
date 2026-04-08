// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/MonitoringLib.sol";

contract MonitoringLibHarness {
    function getCircuitStatus(
        address oracleAggregator,
        address market
    ) external view returns (bool isRestricted, uint256 activeBreakers, bool globalPause) {
        return MonitoringLib.getCircuitBreakerStatus(oracleAggregator, market);
    }
}
