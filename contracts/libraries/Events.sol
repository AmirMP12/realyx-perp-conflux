// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataTypes.sol";

event BreakerTriggered(
    address indexed market,
    DataTypes.BreakerType breakerType,
    uint256 threshold,
    uint256 actualValue
);

event BreakerReset(address indexed market, DataTypes.BreakerType breakerType, address resetBy);

event BreakerResetByAdmin(address indexed market, DataTypes.BreakerType breakerType, address resetBy);

event BreakerEnabledUpdated(address indexed market, DataTypes.BreakerType breakerType, bool enabled);

event CircuitBreakerAlert(
    address indexed market,
    DataTypes.BreakerType breakerType,
    uint256 threshold,
    uint256 currentValue
);

event TWAPUpdated(address indexed market, uint256 twapPrice, uint256 windowSeconds);

event PriceUpdated(address indexed market, uint256 price, uint256 confidence, uint256 timestamp);

event PythFeedSet(address indexed market, bytes32 indexed feedId);

event PriceDeviation(address indexed market, uint256 pythPrice, uint256 aggregatedPrice, uint256 deviationBps);

event EmergencyPauseProposed(bytes32 indexed pauseId, address indexed proposer, address[] targets);

event EmergencyPauseExecuted(bytes32 indexed pauseId, address[] targets);

event EmergencyPauseTargetFailed(bytes32 indexed pauseId, address indexed target);

event GlobalPauseActivated(address indexed activator);

event GlobalPauseDeactivated(address indexed deactivator);

event EmergencyPriceProposed(
    bytes32 indexed proposalId,
    address indexed collection,
    uint256 price,
    address indexed proposer
);

event PriceOverrideExecuted(address indexed collection, uint256 price);

event EmergencyPriceApplied(address indexed collection, uint256 price, uint256 refPrice);
