import { create } from 'zustand';
import type { Market } from '../services/markets';



interface MarketsState {
    markets: Market[];
    loading: boolean;
    error: string | null;
    dataSource: 'onchain' | 'mock' | 'api';
    favorites: string[];
    toggleFavorite: (id: string) => void;
    setMarkets: (markets: Market[]) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    updateMarket: (id: string, data: Partial<Market>) => void;
    updateMarketByAddress: (marketAddress: string, data: Partial<Market>) => void;
}

export const useMarketsStore = create<MarketsState>((set) => ({
    markets: [], // Populated from API (App.tsx); no mock data
    loading: false,
    error: null,
    dataSource: 'api',
    favorites: JSON.parse(localStorage.getItem('favoriteMarkets') || '[]'),
    toggleFavorite: (id) => set((state) => {
        const newFavorites = state.favorites.includes(id)
            ? state.favorites.filter(fav => fav !== id)
            : [...state.favorites, id];
        localStorage.setItem('favoriteMarkets', JSON.stringify(newFavorites));
        return { favorites: newFavorites };
    }),
    setMarkets: (markets) => set({ markets, dataSource: markets.length > 0 ? 'api' : 'api' }),
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
    updateMarket: (id, data) => set((state) => ({
        markets: state.markets.map((m) => m.id === id ? { ...m, ...data } : m)
    })),
    updateMarketByAddress: (marketAddress, data) => set((state) => ({
        markets: state.markets.map((m) =>
            (m.marketAddress || '').toLowerCase() === marketAddress.toLowerCase() ? { ...m, ...data } : m
        )
    })),
}));

import type { Position } from '../hooks/usePositions';

interface PositionsState {
    positions: Position[];
    loading: boolean;
    optimisticPositions: (Position & { isOptimistic?: boolean })[];
    setPositions: (positions: Position[]) => void;
    addPosition: (position: Position) => void;
    removePosition: (id: string | number) => void;
    updatePosition: (id: string | number, data: Partial<Position>) => void;
    addOptimisticPosition: (p: Partial<Position> & { tempId: string }) => void;
    removeOptimisticPosition: (tempId: string) => void;
}

export const usePositionsStore = create<PositionsState>((set) => ({
    positions: [],
    loading: false,
    optimisticPositions: [],
    setPositions: (positions) => set({ positions }),
    addPosition: (position) => set((state) => ({ positions: [...state.positions, position] })),
    removePosition: (id) => set((state) => ({ positions: state.positions.filter((p) => String(p.id) !== String(id)) })),
    updatePosition: (id, data) => set((state) => ({
        positions: state.positions.map((p) => String(p.id) === String(id) ? { ...p, ...data } : p)
    })),
    addOptimisticPosition: (p) => set((state) => ({
        optimisticPositions: [...state.optimisticPositions, { ...p, id: p.tempId, isOptimistic: true } as Position & { isOptimistic: boolean }]
    })),
    removeOptimisticPosition: (tempId) => set((state) => ({
        optimisticPositions: state.optimisticPositions.filter((po) => po.id !== tempId)
    })),
}));

interface ProtocolStats {
    tvl: number;
    volume24h: number;
    markets: number;
    traders: number;
    fees24h: number;
}

interface StatsState {
    stats: ProtocolStats;
    setStats: (stats: Partial<ProtocolStats>) => void;
}

export const useStatsStore = create<StatsState>((set) => ({
    stats: {
        tvl: 0,
        volume24h: 0,
        markets: 0,
        traders: 0,
        fees24h: 0,
    },
    setStats: (stats) => set((state) => ({ stats: { ...state.stats, ...stats } })),
}));
