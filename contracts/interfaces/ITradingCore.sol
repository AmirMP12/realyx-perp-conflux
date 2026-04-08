// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";

/**
 * @title ITradingCore
 * @notice Interface for the main trading engine
 */
interface ITradingCore {
    event PositionOpened(
        uint256 indexed positionId,
        address indexed trader,
        address indexed market,
        bool isLong,
        uint256 size,
        uint256 leverage,
        uint256 entryPrice
    );

    event PositionClosed(
        uint256 indexed positionId,
        address indexed trader,
        int256 realizedPnL,
        uint256 exitPrice,
        uint256 closingFee
    );

    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 liquidationPrice,
        uint256 liquidationFee
    );

    event PositionModified(
        uint256 indexed positionId,
        uint256 newSize,
        uint256 newLeverage,
        uint256 newStopLoss,
        uint256 newTakeProfit
    );

    event CollateralAdded(uint256 indexed positionId, uint256 amount, uint256 newCollateral);

    event CollateralWithdrawn(uint256 indexed positionId, uint256 amount, uint256 newCollateral);

    event FundingSettled(address indexed market, int256 fundingRate, int256 cumulativeFunding, uint256 timestamp);

    event OrderCreated(uint256 indexed orderId, address indexed account, DataTypes.OrderType orderType, address market);

    event OrderExecuted(uint256 indexed orderId, uint256 positionId, address indexed keeper);

    event OrderCancelled(uint256 indexed orderId, string reason);

    event MarketUpdated(address indexed market, uint256 maxLeverage, uint256 maxPositionSize, uint256 maxTotalExposure);

    event FeeConfigUpdated(DataTypes.FeeConfig config);

    event PositionUnderwaterAfterFunding(uint256 indexed positionId, uint256 collateral, uint256 healthFactor);

    function createOrder(
        DataTypes.OrderType orderType,
        address market,
        uint256 sizeDelta,
        uint256 collateralDelta,
        uint256 triggerPrice,
        bool isLong,
        uint256 maxSlippage,
        uint256 positionId
    ) external payable returns (uint256 orderId);

    function executeOrder(uint256 orderId, bytes[] calldata priceUpdateData) external;

    function cancelOrder(uint256 orderId) external;

    function closePosition(DataTypes.ClosePositionParams calldata params) external returns (int256 realizedPnL);

    function partialClose(
        uint256 positionId,
        uint256 closePercent,
        uint256 minReceive,
        uint256 deadline
    ) external returns (int256 realizedPnL);

    function liquidatePosition(uint256 positionId) external returns (uint256 liquidatorReward);

    function setStopLoss(uint256 positionId, uint256 stopLossPrice) external;
    function setTakeProfit(uint256 positionId, uint256 takeProfitPrice) external;
    function setTrailingStop(uint256 positionId, uint256 trailingStopBps) external;

    function addCollateral(uint256 positionId, uint256 amount, uint256 maxLeverage, bool isEmergency) external;

    function withdrawCollateral(uint256 positionId, uint256 amount) external;

    function settleFunding(address market) external;
    function settlePositionFunding(uint256 positionId) external returns (int256 fundingPaid);

    function recordFailedRepayment(
        uint256 positionId,
        uint256 amount,
        address market,
        bool isLong,
        int256 pnl
    ) external;

    function updatePositionOwner(uint256 positionId, address newOwner, address oldOwner) external;

    function getPosition(uint256 positionId) external view returns (DataTypes.Position memory);
    function getPositionPnL(uint256 positionId) external view returns (int256 pnl, uint256 healthFactor);
    function getUserPositions(address user) external view returns (uint256[] memory);

    function getMarketInfo(address market) external view returns (DataTypes.Market memory);
    function getFundingState(address market) external view returns (DataTypes.FundingState memory);
    function canLiquidate(uint256 positionId) external view returns (bool, uint256 healthFactor);
    function nextPositionId() external view returns (uint256);

    function getGlobalUnrealizedPnL() external view returns (int256);
}
