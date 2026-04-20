import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMarketsStore, usePositionsStore, useStatsStore } from '../index';

describe('stores/index.ts', () => {
    beforeEach(() => {
        useMarketsStore.setState({
            markets: [],
            loading: false,
            error: null,
            dataSource: 'api',
            favorites: [],
        });
        usePositionsStore.setState({
            positions: [],
            loading: false,
            optimisticPositions: [],
        });
        useStatsStore.setState({
            stats: { tvl: 0, volume24h: 0, markets: 0, traders: 0, fees24h: 0 },
        });
        localStorage.clear();
    });

    describe('useMarketsStore', () => {
        it('should toggle favorites and persist to localStorage', () => {
            const { toggleFavorite } = useMarketsStore.getState();
            
            toggleFavorite('M1');
            expect(useMarketsStore.getState().favorites).toContain('M1');
            expect(localStorage.getItem('favoriteMarkets')).toBe(JSON.stringify(['M1']));
            
            toggleFavorite('M1');
            expect(useMarketsStore.getState().favorites).not.toContain('M1');
            expect(localStorage.getItem('favoriteMarkets')).toBe(JSON.stringify([]));
        });

        it('should set markets', () => {
            const markets = [{ id: 'M1', symbol: 'S1' }] as any;
            useMarketsStore.getState().setMarkets(markets);
            expect(useMarketsStore.getState().markets).toEqual(markets);
        });

        it('should update market by id', () => {
            useMarketsStore.setState({ markets: [{ id: 'M1', symbol: 'S1', price: 10 }] as any });
            useMarketsStore.getState().updateMarket('M1', { price: 11 });
            expect(useMarketsStore.getState().markets[0].price).toBe(11);
        });

        it('should update market by address', () => {
            useMarketsStore.setState({ markets: [{ id: 'M1', marketAddress: '0xAddress', price: 10 }] as any });
            useMarketsStore.getState().updateMarketByAddress('0xADDRESS', { price: 12 });
            expect(useMarketsStore.getState().markets[0].price).toBe(12);
        });
    });

    describe('usePositionsStore', () => {
        const mockPos = { id: 'P1', size: 100 } as any;

        it('should manage positions', () => {
            const { setPositions, addPosition, updatePosition, removePosition } = usePositionsStore.getState();
            
            setPositions([mockPos]);
            expect(usePositionsStore.getState().positions).toHaveLength(1);
            
            addPosition({ id: 'P2', size: 200 } as any);
            expect(usePositionsStore.getState().positions).toHaveLength(2);
            
            updatePosition('P1', { size: 150 });
            expect(usePositionsStore.getState().positions.find(p => p.id === 'P1')?.size).toBe(150);
            
            removePosition('P1');
            expect(usePositionsStore.getState().positions).toHaveLength(1);
            expect(usePositionsStore.getState().positions[0].id).toBe('P2');
        });

        it('should manage optimistic positions', () => {
            const { addOptimisticPosition, removeOptimisticPosition } = usePositionsStore.getState();
            
            addOptimisticPosition({ tempId: 'T1', size: 50 } as any);
            expect(usePositionsStore.getState().optimisticPositions).toHaveLength(1);
            expect(usePositionsStore.getState().optimisticPositions[0].isOptimistic).toBe(true);
            
            removeOptimisticPosition('T1');
            expect(usePositionsStore.getState().optimisticPositions).toHaveLength(0);
        });
    });

    describe('useStatsStore', () => {
        it('should update stats partially', () => {
            const { setStats } = useStatsStore.getState();
            setStats({ tvl: 1000 });
            expect(useStatsStore.getState().stats.tvl).toBe(1000);
            expect(useStatsStore.getState().stats.volume24h).toBe(0);
            
            setStats({ volume24h: 500 });
            expect(useStatsStore.getState().stats.tvl).toBe(1000);
            expect(useStatsStore.getState().stats.volume24h).toBe(500);
        });
    });
});
