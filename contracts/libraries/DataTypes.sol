// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title DataTypes
 * @notice Core data structures for the RWA Perpetual Futures Protocol
 */
library DataTypes {
    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;
    uint8 public constant USDC_DECIMALS = 6;
    uint256 public constant DECIMAL_CONVERSION = 10 ** 12;

    /// @dev Default / recommended per-market maximum leverage. Markets may be
    ///      configured anywhere in `[MIN_LEVERAGE, MAX_LEVERAGE_LIMIT]`; this is
    ///      the conservative default operators are expected to start from (10x).
    uint256 public constant MAX_LEVERAGE = 10;
    /// @dev Hard ceiling on configurable per-market leverage (100x). The engine
    ///      stores leverage as a 1e18-scaled `uint128` so the full range is
    ///      representable without truncation.
    uint256 public constant MAX_LEVERAGE_LIMIT = 100;
    uint256 public constant MIN_LEVERAGE = 1;

    uint256 public constant FUNDING_INTERVAL = 8 hours;
    /// @dev Default cap on funding intervals settled in a single `settleFunding` call.
    ///      Overridable per-deployment via `TradingCore.setMaxFundingIntervals` so a
    ///      market that has been paused or dormant for more than 8 days can be
    ///      forcibly caught up by a guardian without requiring an upgrade.
    uint256 public constant MAX_FUNDING_INTERVALS = 24;
    uint256 public constant MIN_COMMIT_BLOCKS = 2;
    uint256 public constant FLASH_LOAN_INTERVAL = 30;

    uint256 public constant HEALTH_FACTOR_NEAR_THRESHOLD = 8e17;
    uint256 public constant HEALTH_FACTOR_MEDIUM_RISK = 5e17;
    uint256 public constant HEALTH_FACTOR_LIQUIDATABLE = 1e18;
    uint256 public constant MAX_BAD_DEBT_RATIO_BPS = 500;

    uint256 public constant MAX_BATCH_SIZE = 50;
    uint256 public constant MIN_ORACLE_SOURCES = 1;
    uint256 public constant DUST_THRESHOLD = 10000 * DECIMAL_CONVERSION;
    /// @dev Minimum TWAP samples before opens / triggers use the TWAP gate (2 × 5 min ≈ 10 min warm-up).
    uint256 public constant MIN_TWAP_DATA_POINTS = 2;
    /// @dev Default TWAP slice interval in seconds (30 seconds between each visibleSize execution).
    uint256 public constant DEFAULT_TWAP_INTERVAL = 30;

    enum CollateralType {
        NONE,
        USDC,
        USDT0,
        AXCNH,
        MULTI
    }

    /// @notice Per-token collateral configuration (mirrors CollateralRegistry.CollateralConfig for library use).
    struct CollateralConfig {
        bool enabled;
        uint16 haircutBps;
        uint16 liquidationHaircutBps;
        uint256 maxProtocolExposure;
        address oracleFeed;
        uint8 decimals;
    }

    enum PosStatus {
        NONE,
        OPEN,
        CLOSED,
        LIQUIDATED
    }

    enum BreakerType {
        PRICE_DROP,
        VOLUME_SPIKE,
        TWAP_DEVIATION,
        ORACLE_FAILURE,
        UTILIZATION,
        EMERGENCY
    }

    enum BreakerState {
        INACTIVE,
        TRIGGERED,
        COOLDOWN
    }

    /// @dev Packed into exactly 5 storage slots:
    ///   slot0: size | entryPrice
    ///   slot1: liquidationPrice | stopLossPrice
    ///   slot2: takeProfitPrice | leverage
    ///   slot3: market | openTimestamp | trailingStopBps | flags | collateralType | state
    ///   slot4: collateralToken | lastFundingTime
    /// `leverage` is a 1e18-scaled multiplier (`uint128`) so the full
    /// configurable range up to `MAX_LEVERAGE_LIMIT` (100x = 100e18) is
    /// representable without the prior `uint64` truncation at ~18.44x.
    struct Position {
        uint128 size;
        uint128 entryPrice;
        uint128 liquidationPrice;
        uint128 stopLossPrice;
        uint128 takeProfitPrice;
        uint128 leverage;
        address market;
        uint40 openTimestamp;
        uint16 trailingStopBps;
        uint8 flags;
        CollateralType collateralType;
        PosStatus state;
        address collateralToken;
        uint64 lastFundingTime;
    }

    struct PositionCollateral {
        uint256 amount;
        address tokenAddress;
        uint256 borrowedAmount;
    }

    struct CollateralAllocation {
        address token;
        uint256 amount;
        uint256 usdcValue;
    }

    struct BasketAllocation {
        address[] tokens;
        uint256[] amounts;
        uint256[] usdcValues;
        uint256 totalUsdcValue;
    }

    /// @dev MARGIN MODEL: the protocol selects cross- vs
    ///      isolated-margin GLOBALLY via `TradingCore.crossMarginByDefault`
    ///      (default cross), not per-position. Every newly opened position is
    ///      stamped with that flag in `packFlags`, and `PortfolioRiskLib` only
    ///      aggregates positions whose flag is cross. Per-position selection is
    ///      intentionally NOT exposed on `CreateOrderParams`. The previously
    ///      defined `OpenPositionParams` struct (which carried an unused
    ///      `isCrossMargin` field and was referenced by no contract) has been
    ///      removed to keep the on-chain surface honest.
    struct ClosePositionParams {
        uint256 positionId;
        uint256 closeSize;
        uint256 minReceive;
        uint256 deadline;
    }

    enum OrderType {
        MARKET_INCREASE,
        MARKET_DECREASE,
        LIMIT_INCREASE,
        LIMIT_DECREASE
    }

    /// @notice Time-in-force directive for an order.
    /// GTC       – Good-Til-Cancel: stays in the order book until filled or cancelled.
    /// IOC       – Immediate-Or-Cancel: must be executed in the very next keeper cycle; any unfilled portion is cancelled.
    /// FOK       – Fill-Or-Kill: must be completely filled in one keeper cycle or the entire order is cancelled.
    /// POST_ONLY – Post-only: order is placed only if it would NOT immediately execute (i.e. it rests on the book).
    enum TimeInForce {
        GTC,
        IOC,
        FOK,
        POST_ONLY
    }

    /// @notice Core order struct stored in the _orders mapping.
    /// @dev Iceberg / TWAP slicing: When `visibleSize` < `sizeDelta`, the execution engine only fills
    ///      `visibleSize` per keeper cycle. Once filled, `sizeDelta` is decremented by `visibleSize`
    ///      and the order stays pending. For TWAP, execution also respects `twapInterval`.
    ///      Bracket orders: when a MARKET/LIMIT_INCREASE order is fully executed, stopLossPrice
    ///      and takeProfitPrice are applied to the newly minted Position.
    struct Order {
        uint256 id;
        address account;
        address market;
        uint256 sizeDelta;
        uint256 collateralDelta;
        uint256 triggerPrice;
        uint256 positionId;
        bool isLong;
        OrderType orderType;
        uint256 timestamp;
        uint256 executionFee;
        uint256 maxSlippage;
        CollateralType collateralType;
        address collateralToken;
        /// @notice Time-in-force directive. Default GTC (0) is backwards-compatible.
        TimeInForce tif;
        /// @notice For Bracket Orders: stop-loss price applied to the resulting position when the increase leg fills.
        uint256 stopLossPrice;
        /// @notice For Bracket Orders: take-profit price applied to the resulting position when the increase leg fills.
        uint256 takeProfitPrice;
        /// @notice For Iceberg / TWAP: visible size per execution slice (must be <= sizeDelta).
        uint256 visibleSize;
        /// @notice For TWAP: minimum seconds between slice executions. 0 = no interval constraint.
        uint256 twapInterval;
        /// @notice For TWAP: timestamp of the most recent slice execution.
        uint256 lastExecutionTime;
        /// @notice When true the order MUST NOT increase position size (i.e. Decrease-only semantic).
        bool isReduceOnly;
    }

    /// @notice Bundled parameters for `createOrder` to avoid Stack Too Deep errors.
    /// @dev This struct is passed as a calldata argument to `TradingCore.createOrder`.
    ///      All existing 10-arg fields are preserved; new advanced-order fields are added here.
    struct CreateOrderParams {
        OrderType orderType;
        address market;
        uint256 sizeDelta;
        uint256 collateralDelta;
        uint256 triggerPrice;
        bool isLong;
        uint256 maxSlippage;
        uint256 positionId;
        CollateralType collateralType;
        address collateralToken;
        /// @notice Time-in-force. Default GTC (0) for backwards compatibility.
        TimeInForce tif;
        /// @notice Bracket: stop-loss price applied to the resulting position on fill (increase orders only).
        uint256 stopLossPrice;
        /// @notice Bracket: take-profit price applied to the resulting position on fill (increase orders only).
        uint256 takeProfitPrice;
        /// @notice Iceberg / TWAP: visible size per execution slice. 0 = full size (no slicing).
        uint256 visibleSize;
        /// @notice TWAP: minimum seconds between slice executions. 0 = no interval constraint.
        uint256 twapInterval;
        /// @notice When true, the order must not increase position size (Reduce-only).
        bool isReduceOnly;
        /// @notice Subaccount delegation: the owner who pays collateral and receives the position.
        ///         When owner == address(0) or owner == msg.sender, treated as a direct order.
        ///         When owner != msg.sender, the caller must be an approved subaccount bot for `owner`.
        address owner;
    }

    struct Market {
        address chainlinkFeed;
        uint256 maxStaleness;
        uint256 maxPriceUncertainty;
        uint128 maxPositionSize;
        uint128 maxTotalExposure;
        uint16 maintenanceMargin;
        uint16 initialMargin;
        uint64 maxLeverage;
        uint256 totalLongSize;
        uint256 totalShortSize;
        uint256 totalLongCost;
        uint256 totalShortCost;
        bool isActive;
        bool isListed;
    }

    struct PricePoint {
        uint128 price;
        uint64 timestamp;
        uint64 confidence;
    }

    struct VaultState {
        uint256 totalAssets;
        uint256 totalShares;
        uint256 totalBorrowed;
        uint256 pendingPnL;
        uint256 lastUpdateTime;
    }

    struct MarketExposure {
        uint256 longExposure;
        uint256 shortExposure;
        uint256 maxExposurePercent;
    }

    struct WithdrawalRequest {
        address user;
        uint256 shares;
        uint256 requestTime;
        uint256 minAssets;
        bool processed;
        uint256 reservationAmount;
    }

    struct FeeConfig {
        uint256 makerFeeBps;
        uint256 takerFeeBps;
        uint256 minFeeUsdc;
        uint256 lpShareBps;
        uint256 insuranceShareBps;
        uint256 treasuryShareBps;
    }

    struct LiquidationFeeTiers {
        uint256 nearThresholdBps;
        uint256 mediumRiskBps;
        uint256 deeplyUnderwaterBps;
        uint256 liquidatorShareBps;
    }

    struct FundingState {
        int256 fundingRate;
        int256 cumulativeFunding;
        uint64 lastSettlement;
        uint256 longOpenInterest;
        uint256 shortOpenInterest;
    }

    struct InsuranceFundState {
        uint256 totalAssets;
        uint256 totalShares;
        uint256 targetRatio;
        uint256 minRatio;
        uint256 pendingClaims;
    }

    struct BadDebtClaim {
        uint256 amount;
        uint256 positionId;
        uint256 timestamp;
        bool approved;
        bool paid;
        uint256 amountPaid;
    }

    struct BreakerConfig {
        BreakerType breakerType;
        uint256 threshold;
        uint256 windowSeconds;
        uint256 cooldownSeconds;
        bool enabled;
    }

    struct BreakerStatus {
        BreakerState state;
        uint256 triggeredAt;
        uint256 resetAt;
        address triggeredBy;
    }

    struct FailedRepayment {
        uint256 amount;
        address market;
        bool isLong;
        int256 pnl;
        uint256 timestamp;
        bool resolved;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant TRADING_CORE_ROLE = keccak256("TRADING_CORE_ROLE");

    function isLong(uint8 flags) internal pure returns (bool) {
        return (flags & 0x01) != 0;
    }

    function isCrossMargin(uint8 flags) internal pure returns (bool) {
        return (flags & 0x02) != 0;
    }

    function packFlags(bool _isLong, bool _isCrossMargin) internal pure returns (uint8) {
        uint8 flags;
        if (_isLong) flags |= 0x01;
        if (_isCrossMargin) flags |= 0x02;
        return flags;
    }

    function toInternalPrecision(uint256 usdcAmount) internal pure returns (uint256) {
        return usdcAmount * DECIMAL_CONVERSION;
    }

    function toUsdcPrecision(uint256 internalAmount) internal pure returns (uint256) {
        return internalAmount / DECIMAL_CONVERSION;
    }

    function toUsdcPrecisionCeil(uint256 internalAmount) internal pure returns (uint256) {
        if (internalAmount == 0) return 0;
        return (internalAmount + DECIMAL_CONVERSION - 1) / DECIMAL_CONVERSION;
    }

    struct DustAccumulator {
        uint256 totalDust;
        uint256 lastSweepTimestamp;
        uint256 sweepThreshold;
    }

    struct ProtocolHealthState {
        uint256 totalBadDebt;
        uint64 lastHealthCheck;
        bool isHealthy;
    }

    struct PortfolioRiskConfig {
        uint16 maintenanceMarginBps;
        uint16 concentrationLimitBps;
        uint8 maxCrossPositions;
        bool enabled;
    }

    struct AccountRiskSnapshot {
        uint256 totalNotional;
        uint256 totalCollateral;
        uint256 maintenanceMarginRequirement;
        int256 unrealizedPnL;
        uint256 healthFactor;
        uint256 crossPositionCount;
        bool liquidatable;
    }
}
