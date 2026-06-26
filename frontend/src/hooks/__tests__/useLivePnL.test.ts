import { describe, it, expect } from 'vitest';
import { useLivePnL } from '../useWebSocket';

describe('useLivePnL', () => {
    const markets = [{ marketAddress: '0xMarket', indexPrice: 110 }];

    it('computes long live pnl using mark price', () => {
        const positions = [{ marketAddress: '0xMarket', entryPrice: '100', size: '1000', isLong: true, pnl: '0' }];
        const [r] = useLivePnL(positions, markets);
        expect(r.markPrice).toBe(110);
        expect(r.livePnl).toBeCloseTo(100); // (110-100)*1000/100
    });

    it('computes short live pnl', () => {
        const positions = [{ marketAddress: '0xMarket', entryPrice: '100', size: '1000', isLong: false, pnl: '0' }];
        const [r] = useLivePnL(positions, markets);
        expect(r.livePnl).toBeCloseTo(-100);
    });

    it('falls back to entry price when market not found', () => {
        const positions = [{ marketAddress: '0xUnknown', entryPrice: '100', size: '1000', isLong: true, pnl: '0' }];
        const [r] = useLivePnL(positions, markets);
        expect(r.markPrice).toBe(100);
        expect(r.livePnl).toBe(0);
    });

    it('returns 0 pnl when entry price is invalid', () => {
        const positions = [{ marketAddress: '0xMarket', entryPrice: 'abc', size: '1000', isLong: true, pnl: '0' }];
        const [r] = useLivePnL(positions, markets);
        expect(r.livePnl).toBe(0);
    });
});
