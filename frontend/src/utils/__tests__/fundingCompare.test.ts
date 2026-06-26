import { describe, it, expect } from 'vitest';
import { annualizeFunding, compareFunding, binanceFundingSymbol } from '../fundingCompare';

describe('annualizeFunding', () => {
    it('annualizes an 8h rate into an APR percentage', () => {
        // 0.0001 * 3 * 365 * 100 = 10.95
        expect(annualizeFunding(0.0001)).toBeCloseTo(10.95);
    });
    it('returns 0 for non-finite input', () => {
        expect(annualizeFunding(Infinity)).toBe(0);
        expect(annualizeFunding(NaN)).toBe(0);
    });
});

describe('compareFunding', () => {
    it('returns unknown fairness when no reference', () => {
        const r = compareFunding(0.0001, null);
        expect(r.fairness).toBe('unknown');
        expect(r.referenceRate8h).toBeNull();
        expect(r.referenceApr).toBeNull();
        expect(r.spreadBps8h).toBeNull();
        expect(r.realyxLabel).toContain('%');
    });

    it('returns unknown when reference is not finite', () => {
        expect(compareFunding(0.0001, Infinity).fairness).toBe('unknown');
    });

    it('classifies inline when rates are effectively equal', () => {
        const r = compareFunding(0.0001, 0.0001, 'long');
        expect(r.fairness).toBe('inline');
        expect(r.spreadBps8h).toBeCloseTo(0);
    });

    it('classifies tighter for a long when realyx rate is lower', () => {
        const r = compareFunding(0.00001, 0.001, 'long');
        expect(r.fairness).toBe('tighter');
    });

    it('classifies wider for a long when realyx rate is higher', () => {
        const r = compareFunding(0.001, 0.00001, 'long');
        expect(r.fairness).toBe('wider');
    });

    it('inverts cost direction for shorts', () => {
        // For a short, paying -rate: a higher realyx rate is cheaper (tighter).
        const r = compareFunding(0.001, 0.00001, 'short');
        expect(r.fairness).toBe('tighter');
    });

    it('formats negative realyx rate with sign', () => {
        const r = compareFunding(-0.0002, 0.0001);
        expect(r.realyxLabel.startsWith('-')).toBe(true);
    });
});

describe('binanceFundingSymbol', () => {
    it('maps known crypto markets to USDT perps', () => {
        expect(binanceFundingSymbol('BTC-USD')).toBe('BTCUSDT');
        expect(binanceFundingSymbol('eth')).toBe('ETHUSDT');
        expect(binanceFundingSymbol('CFX')).toBe('CFXUSDT');
    });
    it('returns null for unknown / non-crypto markets', () => {
        expect(binanceFundingSymbol('AAPL-USD')).toBeNull();
        expect(binanceFundingSymbol('GOLD')).toBeNull();
        expect(binanceFundingSymbol(undefined)).toBeNull();
    });
});
