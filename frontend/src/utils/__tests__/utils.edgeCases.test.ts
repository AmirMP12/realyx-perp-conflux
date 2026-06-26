import { describe, it, expect, vi } from 'vitest';
import { formatPriceWithPrecision, formatPercent, safeUsd, truncateAddress, formatPrice } from '../format';
import { getMarketSession } from '../marketHours';
import {
    payForNotional,
    computeMarginPreview,
    triggerReturnPct,
    computeCostToHold,
    formatFundingDisplay,
} from '../tradePreview';

describe('format gaps', () => {
    it('uses 6 decimals for sub-cent prices', () => {
        expect(formatPriceWithPrecision(0.005)).toBe((0.005).toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 }));
    });
    it('uses 4 decimals for sub-dollar prices', () => {
        expect(formatPriceWithPrecision(0.5)).toContain('0.5');
    });
    it('uses 2 decimals for >= $1', () => {
        expect(formatPriceWithPrecision(1234.5)).toContain('1,234.5');
    });
    it('formatPrice / formatPercent / safeUsd / truncateAddress edge cases', () => {
        expect(formatPrice(1.2, 3)).toBe('1.200');
        expect(formatPercent(-2)).toBe('-2.00%');
        expect(safeUsd(null)).toBe(0);
        expect(safeUsd('1,234.5')).toBe(1234.5);
        expect(truncateAddress(undefined)).toBe('—');
        expect(truncateAddress('0x1234')).toBe('0x1234');
    });
});

describe('marketHours gaps', () => {
    it('computes multi-day reopen from a weekend (closed)', () => {
        // 2024-01-06 is a Saturday.
        const sat = new Date('2024-01-06T15:00:00Z');
        const s = getMarketSession('STOCK', sat);
        expect(s.state).toBe('closed');
        expect(s.nextChangeLabel).toMatch(/Reopens/);
        expect(s.msUntilChange).toBeGreaterThan(0);
    });

    it('reports always-open for non-equity categories', () => {
        expect(getMarketSession('CRYPTO').isAlwaysOpen).toBe(true);
    });
});

describe('tradePreview gaps', () => {
    it('payForNotional returns 0 for invalid input and a value otherwise', () => {
        expect(payForNotional(0, 10)).toBe(0);
        expect(payForNotional(1000, 0)).toBe(0);
        expect(payForNotional(1000, 10)).toBeGreaterThan(0);
    });

    it('computeMarginPreview handles zero and min-fee cases', () => {
        expect(computeMarginPreview(0, 10).notionalValue).toBe(0);
        // Tiny size triggers the MIN_OPENING_FEE floor.
        const tiny = computeMarginPreview(0.05, 2);
        expect(tiny.estimatedOpeningFee).toBeCloseTo(0.1);
        expect(tiny.baseMargin).toBe(0);
    });

    it('triggerReturnPct returns null for invalid and a percentage otherwise', () => {
        expect(triggerReturnPct(0, 100, 10, true)).toBeNull();
        expect(triggerReturnPct(110, 100, 10, true)).toBeCloseTo(100);
        expect(triggerReturnPct(90, 100, 10, false)).toBeCloseTo(100);
    });

    it('computeCostToHold covers pay, receive and neutral', () => {
        expect(computeCostToHold(0.001, 1000, true).direction).toBe('pay');
        expect(computeCostToHold(0.001, 1000, false).direction).toBe('receive');
        expect(computeCostToHold(0, 1000, true).direction).toBe('neutral');
        expect(computeCostToHold(NaN, 0, true).fundingPer8h).toBe(0);
    });

    it('formatFundingDisplay covers all tones', () => {
        expect(formatFundingDisplay(0.001).tone).toBe('long-pays');
        expect(formatFundingDisplay(-0.001).tone).toBe('short-pays');
        expect(formatFundingDisplay(0).tone).toBe('neutral');
        expect(formatFundingDisplay(NaN).pct).toBe(0);
    });
});
