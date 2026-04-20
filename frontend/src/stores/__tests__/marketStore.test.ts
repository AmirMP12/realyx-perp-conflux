import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMarketStore } from '../marketStore';
import * as marketService from '../../services/markets';

vi.mock('../../services/markets', () => ({
    fetchMarkets: vi.fn(),
    getMarketStats: vi.fn(),
}));

const mockMarkets = [
    { id: 'CFX-USD', symbol: 'CFX/USD', name: 'Conflux', price: 0.2, change24h: 5 },
    { id: 'BTC-USD', symbol: 'BTC/USD', name: 'Bitcoin', price: 60000, change24h: -2 },
];

const mockStats = {
    totalVolume24h: 1000000,
    totalOpenInterest: 5000000,
    activeTraders: 123,
};

describe('marketStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useMarketStore.setState({
            markets: [],
            stats: null,
            favorites: [],
            isLoading: false,
            error: null,
            lastUpdated: null,
            selectedMarketId: 'CFX-USD',
        });
        localStorage.clear();
    });

    it('should set markets', () => {
        const { setMarkets } = useMarketStore.getState();
        setMarkets(mockMarkets as any);
        
        expect(useMarketStore.getState().markets).toEqual(mockMarkets);
        expect(useMarketStore.getState().lastUpdated).not.toBeNull();
    });

    describe('fetchMarkets', () => {
        it('should fetch and update state on success', async () => {
            vi.mocked(marketService.fetchMarkets).mockResolvedValue(mockMarkets as any);
            vi.mocked(marketService.getMarketStats).mockResolvedValue(mockStats as any);
            
            await useMarketStore.getState().fetchMarkets();
            
            expect(useMarketStore.getState().markets).toEqual(mockMarkets);
            expect(useMarketStore.getState().stats).toEqual(mockStats);
            expect(useMarketStore.getState().isLoading).toBe(false);
            expect(useMarketStore.getState().error).toBeNull();
        });

        it('should handle fetch errors', async () => {
            vi.mocked(marketService.fetchMarkets).mockRejectedValue(new Error('Fetch failed'));
            
            await useMarketStore.getState().fetchMarkets();
            
            expect(useMarketStore.getState().error).toBe('Fetch failed');
            expect(useMarketStore.getState().isLoading).toBe(false);
        });

        it('should skip fetch if loading', async () => {
            useMarketStore.setState({ isLoading: true });
            await useMarketStore.getState().fetchMarkets();
            expect(marketService.fetchMarkets).not.toHaveBeenCalled();
        });

        it('should skip fetch if updated recently (< 60s)', async () => {
            useMarketStore.setState({ 
                markets: mockMarkets as any, 
                lastUpdated: Date.now() - 30000 
            });
            
            await useMarketStore.getState().fetchMarkets();
            expect(marketService.fetchMarkets).not.toHaveBeenCalled();
        });

        it('should fetch if updated long ago (> 60s)', async () => {
            useMarketStore.setState({ 
                markets: mockMarkets as any, 
                lastUpdated: Date.now() - 70000 
            });
            
            vi.mocked(marketService.fetchMarkets).mockResolvedValue(mockMarkets as any);
            vi.mocked(marketService.getMarketStats).mockResolvedValue(mockStats as any);

            await useMarketStore.getState().fetchMarkets();
            expect(marketService.fetchMarkets).toHaveBeenCalled();
        });
    });

    describe('refreshMarkets', () => {
        it('should force refresh even if updated recently', async () => {
            useMarketStore.setState({ 
                markets: mockMarkets as any, 
                lastUpdated: Date.now() - 10000 
            });
            
            vi.mocked(marketService.fetchMarkets).mockResolvedValue(mockMarkets as any);
            vi.mocked(marketService.getMarketStats).mockResolvedValue(mockStats as any);

            await useMarketStore.getState().refreshMarkets();
            expect(marketService.fetchMarkets).toHaveBeenCalled();
        });

        it('should handle refresh errors', async () => {
            vi.mocked(marketService.fetchMarkets).mockRejectedValue(new Error('Refresh failed'));
            
            await useMarketStore.getState().refreshMarkets();
            expect(useMarketStore.getState().error).toBe('Refresh failed');
        });
    });

    it('should get market by id or symbol', () => {
        useMarketStore.setState({ markets: mockMarkets as any });
        const { getMarketById } = useMarketStore.getState();
        
        expect(getMarketById('CFX-USD')).toEqual(mockMarkets[0]);
        expect(getMarketById('BTC/USD')).toEqual(mockMarkets[1]);
        expect(getMarketById('NONEXISTENT')).toBeUndefined();
    });

    it('should select a market', () => {
        const { selectMarket } = useMarketStore.getState();
        selectMarket('BTC-USD');
        expect(useMarketStore.getState().selectedMarketId).toBe('BTC-USD');
    });

    it('should toggle favorites', () => {
        const { toggleFavorite } = useMarketStore.getState();
        
        toggleFavorite('CFX-USD');
        expect(useMarketStore.getState().favorites).toContain('CFX-USD');
        
        toggleFavorite('CFX-USD');
        expect(useMarketStore.getState().favorites).not.toContain('CFX-USD');
        
        toggleFavorite('BTC-USD');
        expect(useMarketStore.getState().favorites).toContain('BTC-USD');
    });
});
