/**
 * Client-side mirror of the protocol's on-chain risk math.
 *
 * These functions are a faithful port of `contracts/libraries/PositionMath.sol`
 * and `PortfolioRiskLib.sol`. They are used to PREVIEW a not-yet-opened position
 * (liquidation price, maintenance margin, health factor). For OPEN positions the
 * UI should prefer the authoritative on-chain reads (`getAccountRisk`,
 * `getPositionPnL`) — see `useAccountRisk`. Keep this file in lockstep with the
 * Solidity constants below if the contracts change.
 */

const BPS = 10000;
const DEFAULT_MAINTENANCE_MARGIN_BPS = 500; // PositionMath.DEFAULT_MAINTENANCE_MARGIN_BPS
const MAX_DYNAMIC_MAINTENANCE_BPS = 2000; // PositionMath.MAX_DYNAMIC_MAINTENANCE_BPS (20%)
const MAINTENANCE_TO_INITIAL_CAP_BPS = 5000; // PositionMath.MAINTENANCE_TO_INITIAL_CAP_BPS (50%)

/**
 * Port of `PositionMath.calculateDynamicMaintenanceMargin`.
 * Returns the maintenance-margin requirement in USD for a position of `size`
 * (USD notional) at `leverage` (plain number, e.g. 10 for 10x).
 */
export function dynamicMaintenanceMargin(size: number, leverage: number): number {
    if (size <= 0 || leverage <= 0) return 0;

    const leverageMultiplier = Math.floor(leverage); // contract divides leverage(1e18) / PRECISION
    let additionalBps = 0;
    if (leverageMultiplier > 5) {
        additionalBps = Math.floor((leverageMultiplier - 5) / 5) * 50;
    }
    let totalBps = DEFAULT_MAINTENANCE_MARGIN_BPS + additionalBps;
    if (totalBps > MAX_DYNAMIC_MAINTENANCE_BPS) totalBps = MAX_DYNAMIC_MAINTENANCE_BPS;

    let margin = (size * totalBps) / BPS;

    // Initial-margin cap: maintenance is capped at 50% of initial margin (size/leverage).
    const initialMargin = size / leverage;
    const cap = (initialMargin * MAINTENANCE_TO_INITIAL_CAP_BPS) / BPS;
    if (margin > cap) margin = cap;

    return margin;
}

/**
 * Port of `PositionMath.calculateLiquidationPrice`.
 * `entryPrice` in USD, `leverage` plain (e.g. 10), `size` in USD notional.
 * Returns the liquidation price in USD, or `null` when the position cannot be
 * liquidated by price alone (sentinel) — e.g. very low leverage longs.
 */
export function isolatedLiquidationPrice(
    entryPrice: number,
    leverage: number,
    size: number,
    isLong: boolean,
): number | null {
    if (entryPrice <= 0 || leverage <= 0) return null;

    const mmMargin = dynamicMaintenanceMargin(size, leverage);
    const mmFraction = size > 0 ? mmMargin / size : DEFAULT_MAINTENANCE_MARGIN_BPS / BPS;
    const inverseL = 1 / leverage;

    if (isLong) {
        // If 1 + mm <= 1/L the position never liquidates on price (sentinel).
        if (1 + mmFraction <= inverseL) return null;
        const factor = 1 + mmFraction - inverseL;
        return entryPrice * factor;
    }
    // Short: if mm >= 1 it's liquidatable at any price (treat as no-clean-price).
    if (mmFraction >= 1) return null;
    const factor = 1 + inverseL - mmFraction;
    return entryPrice * factor;
}

/**
 * Health factor for a single isolated position at `markPrice`, mirroring
 * `PositionMath.isLiquidatable`. 1.0 (1e18 on-chain) is the liquidation
 * threshold. Returns Infinity when there is no maintenance requirement.
 */
export function positionHealthFactor(params: {
    size: number;
    entryPrice: number;
    markPrice: number;
    leverage: number;
    collateral: number;
    isLong: boolean;
}): number {
    const { size, entryPrice, markPrice, leverage, collateral, isLong } = params;
    if (markPrice <= 0 || entryPrice <= 0 || size <= 0) return Infinity;

    const pnl = isLong
        ? (size * (markPrice - entryPrice)) / entryPrice
        : (size * (entryPrice - markPrice)) / entryPrice;
    const effectiveCollateral = collateral + pnl;
    if (effectiveCollateral <= 0) return 0;

    const mm = dynamicMaintenanceMargin(size, leverage);
    if (mm <= 0) return Infinity;
    return effectiveCollateral / mm;
}

/** Human label + tailwind color token for a health factor (1.0 = liquidation). */
export function healthFactorMeta(hf: number): { label: string; tone: 'good' | 'warn' | 'danger' } {
    if (!Number.isFinite(hf)) return { label: 'Safe', tone: 'good' };
    if (hf < 1.1) return { label: 'At risk', tone: 'danger' };
    if (hf < 1.5) return { label: 'Caution', tone: 'warn' };
    return { label: 'Healthy', tone: 'good' };
}

/**
 * Percent price move from `markPrice` to `liqPrice` against the position.
 * Always returned as a positive percentage (distance to liquidation).
 */
export function distanceToLiquidationPct(markPrice: number, liqPrice: number | null, isLong: boolean): number | null {
    if (liqPrice == null || markPrice <= 0) return null;
    const pct = isLong ? ((markPrice - liqPrice) / markPrice) * 100 : ((liqPrice - markPrice) / markPrice) * 100;
    return pct;
}
