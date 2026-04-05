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

    uint256 public constant MAX_LEVERAGE = 30;
    uint256 public constant MAX_LEVERAGE_LIMIT = 100;
    uint256 public constant MIN_LEVERAGE = 1;

    uint256 public constant FUNDING_INTERVAL = 8 hours;
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

    enum CollateralType {
        USDC
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

    struct Position {
        uint128 size;
        uint128 entryPrice;
        uint128 liquidationPrice;
        uint128 stopLossPrice;
        uint128 takeProfitPrice;
        uint64 leverage;
        uint64 lastFundingTime;
        address market;
        uint40 openTimestamp;
        uint16 trailingStopBps;
        uint8 flags;
        CollateralType collateralType;
        PosStatus state;
    }
    
    struct PositionCollateral {
        uint256 amount;
        address tokenAddress;
    }
    
    struct OpenPositionParams {
        address market;
        uint256 size;
        uint256 leverage;
        bool isLong;
        bool isCrossMargin;
        uint256 stopLossPrice;
        uint256 takeProfitPrice;
        uint256 trailingStopBps;
        uint256 expectedPrice;
        uint256 maxSlippageBps;
        uint256 deadline;
        CollateralType collateralType;
    }
    
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
}
