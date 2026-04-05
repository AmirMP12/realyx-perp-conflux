/**
 * Markets Store
 * Zustand store for managing RWA market data
 */

import { create } from 'zustand';
import { fetchMarkets, getMarketStats, type Market, type MarketStats } from '../services/markets';
import { persist, createJSONStorage } from 'zustand/middleware';

interface MarketsState {
    markets: Market[];
    stats: MarketStats | null;
    favorites: string[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: number | null;
    selectedMarketId: string | null;

    setMarkets: (markets: Market[]) => void;
    fetchMarkets: () => Promise<void>;
    refreshMarkets: () => Promise<void>;
    getMarketById: (id: string) => Market | undefined;
    selectMarket: (id: string) => void;
    toggleFavorite: (id: string) => void;
}

export const useMarketStore = create<MarketsState>()(
    persist(
        (set, get) => ({
            markets: [],
            stats: null,
            favorites: [],
            isLoading: false,
            error: null,
            lastUpdated: null,
            selectedMarketId: 'ETH-USD',

            setMarkets: (markets) => set({ markets, lastUpdated: Date.now() }),

            fetchMarkets: async () => {
                const state = get();
                if (state.isLoading) return;
                if (state.markets.length > 0 && state.lastUpdated && Date.now() - state.lastUpdated < 60 * 1000) return;

                set({ isLoading: true, error: null });

                try {
                    const [markets, stats] = await Promise.all([
                        fetchMarkets(),
                        getMarketStats(),
                    ]);

                    set({
                        markets,
                        stats,
                        isLoading: false,
                        lastUpdated: Date.now(),
                    });
                } catch (error: any) {
                    set({
                        isLoading: false,
                        error: error.message || 'Failed to fetch markets',
                    });
                }
            },

            refreshMarkets: async () => {
                set({ isLoading: true, error: null });
                try {
                    const [markets, stats] = await Promise.all([
                        fetchMarkets(),
                        getMarketStats(),
                    ]);

                    set({
                        markets,
                        stats,
                        isLoading: false,
                        lastUpdated: Date.now(),
                    });
                } catch (error: any) {
                    set({
                        isLoading: false,
                        error: error.message || 'Failed to refresh markets',
                    });
                }
            },

            getMarketById: (id: string) => {
                return get().markets.find(
                    c => c.id === id || c.symbol === id
                );
            },

            selectMarket: (id: string) => {
                set({ selectedMarketId: id });
            },

            toggleFavorite: (id: string) => {
                set((state) => {
                    const favorites = state.favorites.includes(id)
                        ? state.favorites.filter((fav) => fav !== id)
                        : [...state.favorites, id];
                    return { favorites };
                });
            }
        }),
        {
            name: 'realyx-market-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                markets: state.markets,
                favorites: state.favorites,
                selectedMarketId: state.selectedMarketId
            }),
        }
    )
);

export function useMarkets() {
    return useMarketStore();
}
