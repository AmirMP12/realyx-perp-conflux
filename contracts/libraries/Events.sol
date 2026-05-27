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

event SubaccountUpdated(address indexed owner, address indexed bot, bool approved);

event PriceOverrideExecuted(address indexed collection, uint256 price);

event EmergencyPriceApplied(address indexed collection, uint256 price, uint256 refPrice);

/// @dev Emitted when a bad-debt claim record is rolled back inside `coverBadDebt`
///      because the cumulative bad-debt circuit breaker tripped before payout.
///      Indexers should treat any earlier `ClaimSubmitted(claimId, …)` for this
///      `claimId` as cancelled.
event ClaimRolledBack(uint256 indexed claimId, uint256 amount, uint256 positionId);

/// @dev Emitted when a liquidation pays out less than the configured
///      `MIN_LIQUIDATOR_REWARD_BPS` floor (or absolute floor) because available
///      collateral + insurance cover were insufficient. The position is still
///      closed; any uncovered shortfall is recorded via `recordFailedRepayment`.
event LiquidatorRewardCapped(
    uint256 indexed positionId,
    address indexed liquidator,
    uint256 paidReward,
    uint256 expectedReward,
    uint256 shortfall
);

/// @dev Emitted when `setTrustedForwarder` toggles a forwarder. Off-chain
///      analytics can use this to track ERC-2771 surface changes.
event TrustedForwarderUpdated(address indexed forwarder, bool trusted);

/// @dev Emitted when `pause()` is auto-expired by a permissionless caller after
///      `globalPauseExpiry` elapses. Re-arms the protocol without requiring an
///      admin signature when the pause was raised by a single guardian.
event GlobalPauseAutoExpired(uint256 timestamp);

/// @dev Emitted when admin proposes/applies an RWA-contract rotation under timelock.
event RWAContractsProposed(address calendar, address dividendManager, address complianceManager, uint256 effective);
event RWAContractsApplied(address calendar, address dividendManager, address complianceManager);

/// @dev Emitted when the keeper reward floor is updated by admin.
event LiquidatorRewardFloorUpdated(uint256 minBps, uint256 absoluteMinUsdc);
