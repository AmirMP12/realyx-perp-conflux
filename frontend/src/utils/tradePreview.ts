/**
 * Pure, framework-free trade-preview math.
 *
 * These helpers previously lived inline in `TradingForm.tsx` (margin/fee
 * derivation) and were duplicated in `Markets.tsx` / `MarketRow` (funding-rate
 * display). Centralizing them here removes that duplication and
 * makes the conversion-critical numbers unit-testable. Keep the constants below
 * in lockstep with the contract fee schedule.
 */

/** Opening-fee rate applied to notional per leverage unit (0.05% × leverage). */
export const OPENING_FEE_RATE = 0.0005;
/** Minimum opening fee in USDC, enforced on-chain. */
export const MIN_OPENING_FEE_USDC = 0.1;
/** Trading (taker) fee rate applied to notional. */
export const TRADING_FEE_RATE = 0.001;

/**
 * Inverse of {@link computeMarginPreview}: given a desired position
 * `targetNotional` and `leverage`, return the total pay (collateral inclusive of
 * the opening fee) the user must supply. Lets the order ticket accept either
 * "Pay" or "Position Size" as the primary input while keeping one fee model.
 */
export function payForNotional(targetNotional: number, leverage: number): number {
    if (!(targetNotional > 0) || !(leverage > 0)) return 0;
    const baseMargin = targetNotional / leverage;
    const rawFee = targetNotional * OPENING_FEE_RATE;
    const fee = Math.max(rawFee, MIN_OPENING_FEE_USDC);
    return baseMargin + fee;
}

export interface MarginPreview {
    /** Collateral actually backing the position after the fee is carved out. */
    baseMargin: number;
    /** Estimated opening fee (floored at MIN_OPENING_FEE_USDC). */
    estimatedOpeningFee: number;
    /** Position notional = baseMargin × leverage. */
    notionalValue: number;
    /** Taker fee on the resulting notional. */
    tradingFee: number;
}

/**
 * Given the user's total spend (`size`, inclusive of the opening fee) and
 * `leverage`, derive the backing margin, fee, and notional. Mirrors the exact
 * arithmetic previously in `TradingForm` so the on-screen preview matches the
 * submitted order.
 */
export function computeMarginPreview(size: number, leverage: number): MarginPreview {
    if (!(size > 0) || !(leverage > 0)) {
        return { baseMargin: 0, estimatedOpeningFee: 0, notionalValue: 0, tradingFee: 0 };
    }

    let baseMargin = size / (1 + leverage * OPENING_FEE_RATE);
    let estimatedOpeningFee = baseMargin * leverage * OPENING_FEE_RATE;

    if (estimatedOpeningFee < MIN_OPENING_FEE_USDC) {
        estimatedOpeningFee = MIN_OPENING_FEE_USDC;
        baseMargin = size - MIN_OPENING_FEE_USDC;
        if (baseMargin < 0) baseMargin = 0;
    }

    const notionalValue = baseMargin * leverage;
    const tradingFee = notionalValue * TRADING_FEE_RATE;

    return { baseMargin, estimatedOpeningFee, notionalValue, tradingFee };
}

/**
 * Percentage move from entry to a take-profit / stop-loss trigger, expressed as
 * a leveraged return on margin. Returns null when inputs are incomplete.
 */
export function triggerReturnPct(
    triggerPrice: number,
    entryPrice: number,
    leverage: number,
    isLong: boolean,
): number | null {
    if (!(triggerPrice > 0) || !(entryPrice > 0) || !(leverage > 0)) return null;
    const move = isLong ? triggerPrice - entryPrice : entryPrice - triggerPrice;
    return (move / entryPrice) * leverage * 100;
}

export interface CostToHold {
    /** Whether this position pays or receives funding at the current rate. */
    direction: 'pay' | 'receive' | 'neutral';
    /** Signed funding cost over one 8h interval in USDC (negative = you receive). */
    fundingPer8h: number;
    /** Signed funding cost over 24h in USDC (3 intervals). */
    fundingPer24h: number;
    /** Absolute magnitude of the 24h funding flow (for display next to direction). */
    abs24h: number;
}

/**
 * "Cost to hold" for an open position: which way funding flows and how much it
 * costs (or pays) per 8h interval and per day. Funding sign convention matches
 * {@link formatFundingDisplay}: a positive 8h rate means longs pay shorts.
 *
 * `fundingRate` is the raw 8h rate (fraction, e.g. 0.0001), `notional` the
 * position size in USD, `isLong` the side.
 */
export function computeCostToHold(fundingRate: number, notional: number, isLong: boolean): CostToHold {
    const safeRate = Number.isFinite(fundingRate) ? fundingRate : 0;
    const n = notional > 0 ? notional : 0;
    // Longs pay when rate>0, receive when rate<0; shorts are the mirror image.
    const longPays = safeRate > 0;
    const youPay = isLong ? longPays : !longPays;
    const magnitude8h = Math.abs(safeRate) * n;
    const signed8h = safeRate === 0 || n === 0 ? 0 : youPay ? magnitude8h : -magnitude8h;
    const direction: CostToHold['direction'] = safeRate === 0 || n === 0 ? 'neutral' : youPay ? 'pay' : 'receive';
    return {
        direction,
        fundingPer8h: signed8h,
        fundingPer24h: signed8h * 3,
        abs24h: magnitude8h * 3,
    };
}

export interface FundingDisplay {
    /** Funding over one 8h settlement interval as a percentage. */
    pct: number;
    /** Signed, fixed-precision label, e.g. "+0.0100%". */
    label: string;
    /**
     * Tone for coloring: positive funding favors shorts (longs pay), negative
     * favors longs, zero is neutral. Matches the existing table coloring.
     */
    tone: 'long-pays' | 'short-pays' | 'neutral';
}

/**
 * Convert a raw 8h funding rate (fraction, e.g. 0.0001) into the per-8h display
 * used across the markets table and trade header. Funding settles every 8h
 * on-chain (`DataTypes.FUNDING_INTERVAL`), so the displayed rate is exactly what
 * a position pays/receives at the next settlement shown by the countdown — and
 * matches the 8h convention used by the funding-fairness panel.
 */
export function formatFundingDisplay(fundingRate: number, precision = 4): FundingDisplay {
    const safeRate = Number.isFinite(fundingRate) ? fundingRate : 0;
    const pct = safeRate * 100;
    const sign = pct > 0 ? '+' : '';
    const label = `${sign}${pct.toFixed(precision)}%`;
    const tone = safeRate > 0 ? 'long-pays' : safeRate < 0 ? 'short-pays' : 'neutral';
    return { pct, label, tone };
}
