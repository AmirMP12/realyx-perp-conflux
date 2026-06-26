import { describe, it, expect } from 'vitest';
import { positionHealthFactor, healthFactorMeta } from '../risk';

describe('positionHealthFactor', () => {
    const base = { size: 1000, entryPrice: 100, leverage: 10, collateral: 100, isLong: true };

    it('returns Infinity for invalid mark/entry/size', () => {
        expect(positionHealthFactor({ ...base, markPrice: 0 })).toBe(Infinity);
        expect(positionHealthFactor({ ...base, entryPrice: 0, markPrice: 100 })).toBe(Infinity);
        expect(positionHealthFactor({ ...base, size: 0, markPrice: 100 })).toBe(Infinity);
    });

    it('returns 0 when effective collateral wiped out by losses', () => {
        // Long with mark far below entry => large negative pnl beyond collateral.
        const hf = positionHealthFactor({ ...base, markPrice: 50 });
        expect(hf).toBe(0);
    });

    it('returns a finite, positive health factor for a healthy long', () => {
        const hf = positionHealthFactor({ ...base, markPrice: 105 });
        expect(hf).toBeGreaterThan(0);
        expect(Number.isFinite(hf)).toBe(true);
    });

    it('computes pnl for shorts (profit when price falls)', () => {
        const hf = positionHealthFactor({ ...base, isLong: false, markPrice: 95 });
        expect(hf).toBeGreaterThan(0);
    });
});

describe('healthFactorMeta', () => {
    it('labels infinite as Safe', () => {
        expect(healthFactorMeta(Infinity)).toEqual({ label: 'Safe', tone: 'good' });
    });
    it('labels < 1.1 as At risk', () => {
        expect(healthFactorMeta(1.05).tone).toBe('danger');
    });
    it('labels < 1.5 as Caution', () => {
        expect(healthFactorMeta(1.3).tone).toBe('warn');
    });
    it('labels healthy', () => {
        expect(healthFactorMeta(2).tone).toBe('good');
    });
});
