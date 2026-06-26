import { describe, it, expect } from 'vitest';
import { useMarketsStore, usePositionsStore } from '../index';

describe('stores/index', () => {
    it('setMarkets handles both empty and non-empty arrays', () => {
        useMarketsStore.getState().setMarkets([]);
        expect(useMarketsStore.getState().markets).toHaveLength(0);
        useMarketsStore.getState().setMarkets([{ id: 'a' } as any, { id: 'b' } as any]);
        expect(useMarketsStore.getState().markets).toHaveLength(2);
    });

    it('updateMarket leaves non-matching markets untouched', () => {
        useMarketsStore.getState().setMarkets([
            { id: 'a', marketAddress: '0xAAA', name: 'A' } as any,
            { id: 'b', marketAddress: '0xBBB', name: 'B' } as any,
        ]);
        useMarketsStore.getState().updateMarket('a', { name: 'A2' } as any);
        const ms = useMarketsStore.getState().markets;
        expect(ms.find((m) => m.id === 'a')?.name).toBe('A2');
        expect(ms.find((m) => m.id === 'b')?.name).toBe('B');
    });

    it('updateMarketByAddress leaves non-matching markets untouched', () => {
        useMarketsStore.getState().setMarkets([
            { id: 'a', marketAddress: '0xAAA', symbol: 'A' } as any,
            { id: 'b', marketAddress: '0xBBB', symbol: 'B' } as any,
        ]);
        useMarketsStore.getState().updateMarketByAddress('0xaaa', { symbol: 'A2' } as any);
        const ms = useMarketsStore.getState().markets;
        expect(ms.find((m) => m.id === 'a')?.symbol).toBe('A2');
        expect(ms.find((m) => m.id === 'b')?.symbol).toBe('B');
    });

    it('updatePosition and removePosition handle matching and non-matching ids', () => {
        const s = usePositionsStore.getState();
        s.setPositions([{ id: '1' } as any, { id: '2' } as any]);
        s.updatePosition('1', { pnl: '9' } as any);
        const ps = usePositionsStore.getState().positions;
        expect(ps.find((p) => String(p.id) === '1')?.pnl).toBe('9');
        expect(ps.find((p) => String(p.id) === '2')?.pnl).toBeUndefined();
        s.removePosition('1');
        expect(usePositionsStore.getState().positions.map((p) => p.id)).toEqual(['2']);
    });

    it('removeOptimisticPosition keeps non-matching optimistic entries', () => {
        const s = usePositionsStore.getState();
        s.addOptimisticPosition({ tempId: 'opt-1' } as any);
        s.addOptimisticPosition({ tempId: 'opt-2' } as any);
        s.removeOptimisticPosition('opt-1');
        expect(usePositionsStore.getState().optimisticPositions.map((p) => p.id)).toEqual(['opt-2']);
    });
});
