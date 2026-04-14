// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";

/**
 * @title ITradingCore
 * @notice Interface for the perpetual futures trading engine: positions, orders, funding, and read paths used by integrators and the vault.
 * @dev Reverts and events are defined on the implementation; decode custom errors from `TradingCore` for user-facing flows.
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

    /**
     * @notice Create a limit or market order (open, increase, decrease, or close path depending on `orderType`).
     * @param orderType Kind of order (market/limit, increase/decrease).
     * @param market Market contract address (must be listed and pass compliance when configured).
     * @param sizeDelta Notional size change in USDC precision (protocol-specific interpretation per order type).
     * @param collateralDelta Collateral to add or adjust with the order, USDC precision.
     * @param triggerPrice Limit trigger price; ignored for pure market orders when not applicable.
     * @param isLong True for long, false for short.
     * @param maxSlippage Maximum acceptable slippage for execution (BPS or internal encoding per implementation).
     * @param positionId Existing position id for modify/close flows; `0` for new position leg when applicable.
     * @return orderId Opaque order identifier for `executeOrder` / `cancelOrder`.
     * @dev Payable: caller must forward the configured minimum execution fee as `msg.value` when required.
     */
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

    /**
     * @notice Keeper entry: execute a queued order using fresh oracle data.
     * @param orderId Order returned by `createOrder`.
     * @param priceUpdateData Pyth `updatePriceFeeds` payload (or empty when not needed for that market).
     * @dev Restricted to keepers; updates positions, vault, and NFT state atomically.
     */
    function executeOrder(uint256 orderId, bytes[] calldata priceUpdateData) external;

    /**
     * @notice Cancel an unfilled order and refund escrowed funds per implementation rules.
     * @param orderId Order to cancel; must be owned by the caller where applicable.
     */
    function cancelOrder(uint256 orderId) external;

    /**
     * @notice Close a position (or remaining size) at market using `params`.
     * @param params Packed close parameters (position id, size, min receive, deadline).
     * @return realizedPnL Signed PnL attributed to the trader for this close (fees and funding applied per implementation).
     */
    function closePosition(DataTypes.ClosePositionParams calldata params) external returns (int256 realizedPnL);

    /**
     * @notice Partially close an open position by percentage of current size.
     * @param positionId Position NFT / id.
     * @param closePercent Size fraction to close, in protocol precision (`1e18` = 100%).
     * @param minReceive Minimum USDC (or collateral) the trader must receive after fees; reverts if not met.
     * @param deadline Unix timestamp after which the call reverts.
     * @return realizedPnL Signed PnL for the closed portion.
     * @dev Remaining size after close must stay zero or above `minPositionSize`; otherwise reverts.
     */
    function partialClose(
        uint256 positionId,
        uint256 closePercent,
        uint256 minReceive,
        uint256 deadline
    ) external returns (int256 realizedPnL);

    /**
     * @notice Liquidate an underwater position; pays a reward to `msg.sender` when successful.
     * @param positionId Position to liquidate.
     * @return liquidatorReward USDC amount transferred to the liquidator as incentive.
     */
    function liquidatePosition(uint256 positionId) external returns (uint256 liquidatorReward);

    /**
     * @notice Set or update stop-loss price for an open position.
     * @param positionId Position id.
     * @param stopLossPrice Trigger price in oracle price units.
     */
    function setStopLoss(uint256 positionId, uint256 stopLossPrice) external;

    /**
     * @notice Set or update take-profit price for an open position.
     * @param positionId Position id.
     * @param takeProfitPrice Trigger price in oracle price units.
     */
    function setTakeProfit(uint256 positionId, uint256 takeProfitPrice) external;

    /**
     * @notice Configure trailing stop distance in basis points of price.
     * @param positionId Position id.
     * @param trailingStopBps Distance in BPS (implementation-enforced maximum).
     */
    function setTrailingStop(uint256 positionId, uint256 trailingStopBps) external;

    /**
     * @notice Add collateral to a position; may optionally bypass some checks when `isEmergency`.
     * @param positionId Position id.
     * @param amount USDC amount to add (6 decimals).
     * @param maxLeverage Upper bound on leverage after add (implementation validates).
     * @param isEmergency When true, uses emergency collateral path if implemented.
     */
    function addCollateral(uint256 positionId, uint256 amount, uint256 maxLeverage, bool isEmergency) external;

    /**
     * @notice Withdraw excess collateral while keeping the position healthy.
     * @param positionId Position id.
     * @param amount USDC amount to withdraw.
     */
    function withdrawCollateral(uint256 positionId, uint256 amount) external;

    /**
     * @notice Accrue and persist funding for all open interest on `market`.
     * @param market Market address.
     */
    function settleFunding(address market) external;

    /**
     * @notice Settle funding (and dividend hooks if configured) for a single position.
     * @param positionId Position id.
     * @return fundingPaid Signed funding paid by the trader (negative means receipt).
     */
    function settlePositionFunding(uint256 positionId) external returns (int256 fundingPaid);

    /**
     * @notice Internal hook: record a vault repayment shortfall for bad-debt accounting (callable only by trusted modules).
     * @param positionId Associated position.
     * @param amount Shortfall amount in USDC precision.
     * @param market Market address.
     * @param isLong Position direction.
     * @param pnl Signed PnL context for the failed leg.
     */
    function recordFailedRepayment(
        uint256 positionId,
        uint256 amount,
        address market,
        bool isLong,
        int256 pnl
    ) external;

    /**
     * @notice Callback used by `PositionToken` when an NFT owner changes so internal owner maps stay consistent.
     * @param positionId Position id.
     * @param newOwner New owner of the position NFT.
     * @param oldOwner Previous owner recorded by the token.
     */
    function updatePositionOwner(uint256 positionId, address newOwner, address oldOwner) external;

    /**
     * @notice Snapshot of an open position struct.
     * @param positionId Position id.
     */
    function getPosition(uint256 positionId) external view returns (DataTypes.Position memory);

    /**
     * @notice Mark-to-market PnL and health factor for a position (delegates to configured views contract when set).
     * @param positionId Position id.
     * @return pnl Unrealized PnL in internal precision.
     * @return healthFactor Collateralization health scalar (implementation-defined scale).
     */
    function getPositionPnL(uint256 positionId) external view returns (int256 pnl, uint256 healthFactor);

    /**
     * @notice List of position ids currently held by `user`.
     * @param user Trader address.
     */
    function getUserPositions(address user) external view returns (uint256[] memory);

    /**
     * @notice Market configuration and caps.
     * @param market Market contract address.
     */
    function getMarketInfo(address market) external view returns (DataTypes.Market memory);

    /**
     * @notice Funding index state for a market.
     * @param market Market contract address.
     */
    function getFundingState(address market) external view returns (DataTypes.FundingState memory);

    /**
     * @notice Whether a position is liquidatable and its health factor.
     * @param positionId Position id.
     * @return can True if liquidatable under current prices and rules.
     * @return healthFactor Current health scalar.
     */
    function canLiquidate(uint256 positionId) external view returns (bool, uint256 healthFactor);

    /**
     * @notice Monotonic id allocator: next position id that will be minted on the next open.
     */
    function nextPositionId() external view returns (uint256);

    /**
     * @notice Sum of unrealized PnL across all open positions (vault-facing risk metric).
     * @return totalPnL Signed aggregate unrealized PnL in internal precision.
     */
    function getGlobalUnrealizedPnL() external view returns (int256);
}
