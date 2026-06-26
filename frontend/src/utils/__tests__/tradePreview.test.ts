import { describe, it, expect } from 'vitest';
import {
    computeMarginPreview,
    payForNotional,
    triggerReturnPct,
    formatFundingDisplay,
    OPENING_FEE_RATE,
    MIN_OPENING_FEE_USDC,
    TRADING_FEE_RATE,
} from '../tradePreview';

describe('tradePreview.computeMarginPreview', () => {
    it('returns zeros for non-positive inputs', () => {
        expect(computeMarginPreview(0, 10)).toEqual({
            baseMargin: 0,
            estimatedOpeningFee: 0,
            notionalValue: 0,
            tradingFee: 0,
        });
        expect(computeMarginPreview(100, 0)).toEqual({
            baseMargin: 0,
            estimatedOpeningFee: 0,
            notionalValue: 0,
            tradingFee: 0,
        });
    });

    it('carves the opening fee out of total spend so margin+fee reconciles to size', () => {
        const size = 100;
        const leverage = 10;
        const { baseMargin, estimatedOpeningFee } = computeMarginPreview(size, leverage);
        // Spend is inclusive of the fee: baseMargin + fee ≈ size.
        expect(baseMargin + estimatedOpeningFee).toBeCloseTo(size, 6);
    });

    it('computes notional and trading fee from the resulting base margin', () => {
        const size = 100;
        const leverage = 10;
        const { baseMargin, notionalValue, tradingFee } = computeMarginPreview(size, leverage);
        expect(notionalValue).toBeCloseTo(baseMargin * leverage, 9);
        expect(tradingFee).toBeCloseTo(notionalValue * TRADING_FEE_RATE, 9);
    });

    it('matches the exact pre-extraction formula', () => {
        const size = 250;
        const leverage = 20;
        const expectedBase = size / (1 + leverage * OPENING_FEE_RATE);
        const expectedFee = expectedBase * leverage * OPENING_FEE_RATE;
        const { baseMargin, estimatedOpeningFee } = computeMarginPreview(size, leverage);
        expect(baseMargin).toBeCloseTo(expectedBase, 9);
        expect(estimatedOpeningFee).toBeCloseTo(expectedFee, 9);
    });

    it('enforces the minimum opening fee on tiny positions', () => {
        // Small size + low leverage => computed fee below the floor.
        const { estimatedOpeningFee, baseMargin } = computeMarginPreview(5, 1);
        expect(estimatedOpeningFee).toBe(MIN_OPENING_FEE_USDC);
        expect(baseMargin).toBeCloseTo(5 - MIN_OPENING_FEE_USDC, 9);
    });

    it('never returns negative margin when fee floor exceeds spend', () => {
        const { baseMargin } = computeMarginPreview(0.05, 1);
        expect(baseMargin).toBe(0);
    });
});

describe('tradePreview.payForNotional', () => {
    it('round-trips with computeMarginPreview for normal positions', () => {
        const leverage = 10;
        const targetNotional = 1000;
        const pay = payForNotional(targetNotional, leverage);
        // Feeding the derived pay back in should reproduce the target notional.
        const { notionalValue } = computeMarginPreview(pay, leverage);
        expect(notionalValue).toBeCloseTo(targetNotional, 4);
    });

    it('returns 0 for non-positive inputs', () => {
        expect(payForNotional(0, 10)).toBe(0);
        expect(payForNotional(1000, 0)).toBe(0);
    });

    it('honors the minimum opening fee on small notionals', () => {
        // notional * 0.0005 below the floor → fee pinned to MIN.
        const pay = payForNotional(50, 1);
        expect(pay).toBeCloseTo(50 / 1 + MIN_OPENING_FEE_USDC, 9);
    });
});

describe('tradePreview.triggerReturnPct', () => {
    it('is positive for a long TP above entry and negative for a long SL below entry', () => {
        const tp = triggerReturnPct(1100, 1000, 10, true);
        const sl = triggerReturnPct(950, 1000, 10, true);
        expect(tp).toBeCloseTo(((1100 - 1000) / 1000) * 10 * 100, 9); // +100%
        expect(sl).toBeCloseTo(((950 - 1000) / 1000) * 10 * 100, 9); // -50%
    });

    it('flips sign convention for shorts', () => {
        const tp = triggerReturnPct(900, 1000, 5, false); // price down is profit
        expect(tp).toBeCloseTo(((1000 - 900) / 1000) * 5 * 100, 9); // +50%
    });

    it('returns null for incomplete inputs', () => {
        expect(triggerReturnPct(0, 1000, 10, true)).toBeNull();
        expect(triggerReturnPct(1100, 0, 10, true)).toBeNull();
        expect(triggerReturnPct(1100, 1000, 0, true)).toBeNull();
    });
});

describe('tradePreview.formatFundingDisplay', () => {
    it('shows the raw 8h settlement rate and signs positives', () => {
        const d = formatFundingDisplay(0.0001); // 0.01% over 8h
        expect(d.pct).toBeCloseTo(0.0001 * 100, 9);
        expect(d.label.startsWith('+')).toBe(true);
        expect(d.tone).toBe('long-pays');
    });

    it('marks negative funding as short-pays without a plus sign', () => {
        const d = formatFundingDisplay(-0.0002);
        expect(d.pct).toBeLessThan(0);
        expect(d.label.startsWith('+')).toBe(false);
        expect(d.tone).toBe('short-pays');
    });

    it('is neutral at exactly zero', () => {
        const d = formatFundingDisplay(0);
        expect(d.pct).toBe(0);
        expect(d.tone).toBe('neutral');
    });

    it('guards against non-finite input', () => {
        const d = formatFundingDisplay(NaN);
        expect(d.pct).toBe(0);
        expect(d.tone).toBe('neutral');
    });

    it('respects the precision argument', () => {
        expect(formatFundingDisplay(0.0001, 2).label).toMatch(/^\+\d+\.\d{2}%$/);
    });
});
