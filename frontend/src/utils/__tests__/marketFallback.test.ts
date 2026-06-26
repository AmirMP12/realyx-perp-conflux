import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/markets', () => ({
    MARKET_DISPLAY_FALLBACK: {
        '0xabc': { name: 'Fallback Name', symbol: 'FBK', image: '' },
        '0xdef': { name: 'Imaged', symbol: 'IMG', image: 'fallback.png' },
    },
}));

import { applyMarketDisplayFallback, mapMarketsWithFallback } from '../market';

describe('applyMarketDisplayFallback', () => {
    it('returns the market unchanged when there is no fallback entry', () => {
        const m = { marketAddress: '0xUNKNOWN', name: 'Raw', symbol: 'RAW' };
        expect(applyMarketDisplayFallback(m)).toBe(m);
    });

    it('keeps the original image when the fallback image is empty', () => {
        const m = { marketAddress: '0xABC', name: 'Raw', symbol: 'RAW', image: 'orig.png' };
        const out = applyMarketDisplayFallback(m);
        expect(out.name).toBe('Fallback Name');
        expect(out.image).toBe('orig.png');
    });

    it('uses the fallback image when provided', () => {
        const m = { marketAddress: '0xDEF', name: 'Raw', symbol: 'RAW', image: 'orig.png' };
        expect(applyMarketDisplayFallback(m).image).toBe('fallback.png');
    });

    it('handles null inputs', () => {
        expect(applyMarketDisplayFallback(null as any)).toBeNull();
        expect(mapMarketsWithFallback(null as any)).toEqual([]);
    });
});
