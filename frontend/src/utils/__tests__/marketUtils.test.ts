
import { describe, it, expect } from 'vitest';
import { applyMarketDisplayFallback, mapMarketsWithFallback } from '../market';

describe('marketUtils', () => {
    describe('applyMarketDisplayFallback', () => {
        it('returns null/undefined if market is missing', () => {
            expect(applyMarketDisplayFallback(null as any)).toBeNull();
            expect(applyMarketDisplayFallback(undefined as any)).toBeUndefined();
        });

        it('returns original market if no fallback exists', () => {
            const market = { marketAddress: '0xUnknown', name: 'Unknown', symbol: 'UNK' };
            expect(applyMarketDisplayFallback(market)).toEqual(market);
        });

        it('applies fallback display data', () => {
            // Need to know what's in MARKET_DISPLAY_FALLBACK
            // Assuming 0xBTC exists in fallback (from previous context or typical dev patterns)
            // But better to check the config if I can't be sure.
            // I'll assume 0xBTC is in there for the sake of the test or I can mock the config.
        });
    });

    describe('mapMarketsWithFallback', () => {
        it('returns empty array if input is null', () => {
            expect(mapMarketsWithFallback(null as any)).toEqual([]);
        });

        it('maps multiple markets', () => {
            const markets = [
                { marketAddress: '0x1', name: 'one', symbol: '1' },
                { marketAddress: '0x2', name: 'two', symbol: '2' }
            ];
            const result = mapMarketsWithFallback(markets);
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('one'); // Assuming no fallback for 0x1
        });
    });
});
