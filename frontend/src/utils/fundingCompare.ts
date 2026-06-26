/**
 * Funding-rate competitiveness math.
 *
 * Traders judge a perp venue partly on whether its funding is fair versus the
 * centralized references they already use. These helpers annualize Realyx's
 * on-chain 8h funding and classify how its cost compares to an external
 * reference (e.g. a CEX perp's funding) so the UI can prove fairness rather
 * than assert it.
 */

/** Funding intervals per day (8h funding → 3 settlements/day). */
export const FUNDING_INTERVALS_PER_DAY = 3;
const DAYS_PER_YEAR = 365;

/**
 * Annualize an 8h funding rate (fraction, e.g. 0.0001 = 0.01%/8h) into an APR
 * percentage. Positive = longs pay shorts over the year.
 */
export function annualizeFunding(rate8h: number): number {
    if (!Number.isFinite(rate8h)) return 0;
    return rate8h * FUNDING_INTERVALS_PER_DAY * DAYS_PER_YEAR * 100;
}

export type FundingFairness = 'tighter' | 'inline' | 'wider' | 'unknown';

export interface FundingComparison {
    /** Realyx 8h rate as a signed percentage string label, e.g. "+0.0100%". */
    realyxLabel: string;
    /** Realyx annualized APR (signed %). */
    realyxApr: number;
    /** Reference (CEX) 8h rate as a fraction, or null when unavailable. */
    referenceRate8h: number | null;
    /** Reference annualized APR (signed %), or null. */
    referenceApr: number | null;
    /**
     * Absolute spread between Realyx and reference 8h rates, in basis points of
     * notional per 8h. Null when no reference.
     */
    spreadBps8h: number | null;
    /**
     * Fairness verdict from the trader's perspective — whether Realyx funding is
     * cheaper to hold ('tighter'), comparable ('inline'), or more expensive
     * ('wider') than the reference for the given side.
     */
    fairness: FundingFairness;
}

function fmtPct(rateFraction: number, precision = 4): string {
    const pct = rateFraction * 100;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(precision)}%`;
}

/**
 * Compare Realyx's 8h funding against an external reference. `side` lets us
 * judge cost from the trader's perspective: a long pays positive funding, so a
 * lower Realyx rate than the reference is "tighter" (cheaper) for a long.
 */
export function compareFunding(
    realyxRate8h: number,
    referenceRate8h: number | null,
    side: 'long' | 'short' = 'long',
): FundingComparison {
    const realyxApr = annualizeFunding(realyxRate8h);
    if (referenceRate8h == null || !Number.isFinite(referenceRate8h)) {
        return {
            realyxLabel: fmtPct(realyxRate8h),
            realyxApr,
            referenceRate8h: null,
            referenceApr: null,
            spreadBps8h: null,
            fairness: 'unknown',
        };
    }

    const referenceApr = annualizeFunding(referenceRate8h);
    const spreadBps8h = Math.abs(realyxRate8h - referenceRate8h) * 10_000;

    // Cost to the trader's side: longs pay +rate, shorts pay -rate.
    const realyxCost = side === 'long' ? realyxRate8h : -realyxRate8h;
    const refCost = side === 'long' ? referenceRate8h : -referenceRate8h;
    const diff = realyxCost - refCost;

    // Within ~0.5bp/8h is effectively the same venue-to-venue.
    let fairness: FundingFairness;
    if (Math.abs(diff) * 10_000 < 0.5) fairness = 'inline';
    else if (diff < 0) fairness = 'tighter';
    else fairness = 'wider';

    return {
        realyxLabel: fmtPct(realyxRate8h),
        realyxApr,
        referenceRate8h,
        referenceApr,
        spreadBps8h,
        fairness,
    };
}

/**
 * Map a Realyx market symbol (e.g. "BTC-USD") to the Binance USDⓈ-M perp symbol
 * used by their public funding endpoint. Returns null for assets without a CEX
 * perp reference (tokenized equities, gold, etc.) so callers can show "n/a".
 */
export function binanceFundingSymbol(marketSymbol: string | undefined): string | null {
    if (!marketSymbol) return null;
    const base = marketSymbol.toUpperCase().replace(/-USD$/, '');
    // Crypto perps that exist on Binance USDⓈ-M.
    const CRYPTO = new Set(['BTC', 'ETH', 'CFX', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK', 'MATIC']);
    if (CRYPTO.has(base)) return `${base}USDT`;
    return null; // equities/commodities have no CEX perp funding reference
}
