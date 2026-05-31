import { ethers } from "hardhat";

/**
 * Protocol-wide constants mirrored from contracts/libraries/DataTypes.sol.
 * Keeping them here lets tests assert against the exact on-chain values
 * without re-reading storage in every spec.
 */

// ─── Precision ────────────────────────────────────────────────────────────
export const PRECISION = 10n ** 18n; // 1e18 internal precision
export const BPS = 10_000n;
export const USDC_DECIMALS = 6;
export const DECIMAL_CONVERSION = 10n ** 12n; // 1e18 / 1e6

// ─── Leverage bounds ──────────────────────────────────────────────────────
export const MAX_LEVERAGE = 30n;
export const MAX_LEVERAGE_LIMIT = 100n;
export const MIN_LEVERAGE = 1n;

// ─── Funding ──────────────────────────────────────────────────────────────
export const FUNDING_INTERVAL = 8n * 60n * 60n; // 8 hours
export const MAX_FUNDING_INTERVALS = 24n;
export const BASE_FUNDING_RATE = 10n ** 14n; // 1e14

// ─── Health factor thresholds ─────────────────────────────────────────────
export const HEALTH_FACTOR_NEAR_THRESHOLD = 8n * 10n ** 17n; // 0.8e18
export const HEALTH_FACTOR_MEDIUM_RISK = 5n * 10n ** 17n; // 0.5e18
export const HEALTH_FACTOR_LIQUIDATABLE = PRECISION; // 1e18

// ─── Misc ─────────────────────────────────────────────────────────────────
export const MAX_BATCH_SIZE = 50n;
export const DUST_THRESHOLD = 10_000n * DECIMAL_CONVERSION;
export const UPGRADE_TIMELOCK = 48n * 60n * 60n; // 48 hours
export const RWA_TIMELOCK = 48n * 60n * 60n;

// ─── Roles (keccak256 of role name) ───────────────────────────────────────
export const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
export const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
export const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
export const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
export const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
export const LIQUIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE"));
export const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
export const TRADING_CORE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TRADING_CORE_ROLE"));
export const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));
export const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
export const UPGRADER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE"));
export const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));

// ─── Enums (mirror DataTypes) ─────────────────────────────────────────────
export enum CollateralType {
    NONE = 0,
    USDC = 1,
    USDT0 = 2,
    AXCNH = 3,
    MULTI = 4,
}

export enum PosStatus {
    NONE = 0,
    OPEN = 1,
    CLOSED = 2,
    LIQUIDATED = 3,
}

export enum BreakerType {
    PRICE_DROP = 0,
    VOLUME_SPIKE = 1,
    TWAP_DEVIATION = 2,
    ORACLE_FAILURE = 3,
    UTILIZATION = 4,
    EMERGENCY = 5,
}

export enum BreakerState {
    INACTIVE = 0,
    TRIGGERED = 1,
    COOLDOWN = 2,
}

export enum OrderType {
    MARKET_INCREASE = 0,
    MARKET_DECREASE = 1,
    LIMIT_INCREASE = 2,
    LIMIT_DECREASE = 3,
}

export enum TimeInForce {
    GTC = 0,
    IOC = 1,
    FOK = 2,
    POST_ONLY = 3,
}

// ─── USDC helpers ─────────────────────────────────────────────────────────
export const usdc = (n: number | bigint | string): bigint => ethers.parseUnits(n.toString(), USDC_DECIMALS);

export const toInternal = (usdcAmount: bigint): bigint => usdcAmount * DECIMAL_CONVERSION;
export const toUsdc = (internalAmount: bigint): bigint => internalAmount / DECIMAL_CONVERSION;

// A sample Pyth feed id used across tests.
export const FEED_ID_BTC = ethers.zeroPadValue("0x01", 32);
export const FEED_ID_ETH = ethers.zeroPadValue("0x02", 32);
export const FEED_ID_AAPL = ethers.zeroPadValue("0x03", 32);
