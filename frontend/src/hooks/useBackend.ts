import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { MARKET_DISPLAY_FALLBACK } from '../config/markets';

import { getApiBaseUrl } from '../config/api';

const API_BASE_URL = getApiBaseUrl();

export interface BackendMarket {
    id: string;
    name: string;
    symbol: string;
    image: string;
    marketAddress: string;
    category?: 'CRYPTO' | 'STOCK' | 'COMMODITY' | 'FOREX';
    indexPrice: string;
    lastPrice: string;
    volume24h: string;
    longOI: string;
    shortOI: string;
    fundingRate: string;
    maxLeverage: number;
    isPaused: boolean;
    change24h?: number;
}

const FALLBACK_CATEGORY: Record<string, 'CRYPTO' | 'STOCK' | 'COMMODITY' | 'FOREX'> = {
  '0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c': 'CRYPTO',
  '0x986a383f6de4a24dd3f524f0f93546229b58265f': 'CRYPTO', '0x886a383f6de4a24dd3f524f0f93546229b58265f': 'CRYPTO',
  '0x286a383f6de4a24dd3f524f0f93546229b58265f': 'COMMODITY',
  '0x786a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK', '0x686a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK',
  '0x586a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK', '0x486a383f6de4a24dd3f524f0f93546229b58265f': 'CRYPTO',
  '0x386a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK', '0x946a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK',
  '0x956a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK', '0x966a383f6de4a24dd3f524f0f93546229b58265f': 'CRYPTO',
  '0x976a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK',
  '0x006a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK', '0x116a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK',
  '0x706a383f6de4a24dd3f524f0f93546229b58265f': 'STOCK',
};


const PLACEHOLDER_MARKETS: BackendMarket[] = Object.entries(MARKET_DISPLAY_FALLBACK).map(([addr, meta]) => ({
  id: addr.toLowerCase(),
  name: meta.name,
  symbol: meta.symbol,
  image: meta.image,
  marketAddress: addr,
  category: FALLBACK_CATEGORY[addr.toLowerCase()] ?? 'CRYPTO',
  indexPrice: '0',
  lastPrice: '0',
  volume24h: '0',
  longOI: '0',
  shortOI: '0',
  fundingRate: '0',
  maxLeverage: 30,
  isPaused: false,
}));

const STALE_MS = 30_000; // 30s cache so multiple components share one request
const HAS_WS = Boolean((import.meta.env.VITE_WS_URL ?? '').trim());
const MARKETS_POLL_MS = HAS_WS ? 1_000 : 5_000; // 1s when WS provides live updates; 5s when REST-only (Vercel)

export interface TradeHistoryItem {
    id: number;
    signature: string;
    market: string;
    side: 'LONG' | 'SHORT';
    size: string;
    price: string;
    leverage: number;
    fee: string;
    pnl: string | null;
    type: 'OPEN' | 'CLOSE' | 'LIQUIDATED';
    timestamp: string;
}

export interface BackendPosition {
    id: number;
    market: {
        id: string;
        name: string;
        symbol: string;
        collectionName: string;
        collectionImage: string;
    };
    side: 'LONG' | 'SHORT';
    size: string;
    entryPrice: string;
    margin: string;
    leverage: number;
    unrealizedPnl: string;
    realizedPnl: string;
    liquidationPrice: string;
    breakEvenPrice: string;
    openTs: string;
}

export interface ProtocolStats {
    totalMarkets: number;
    volume24h: string;
    totalOpenInterest: string;
    totalLiquidations?: string;
}

export function useTradeHistory(limit = 20) {
    const { address } = useAccount();

    const {
        data: trades = [],
        isLoading: loading,
        error: err,
        refetch,
    } = useQuery({
        queryKey: ['backend', 'trades', address, limit],
        queryFn: async (): Promise<TradeHistoryItem[]> => {
            if (!address) return [];
            const response = await fetch(`${API_BASE_URL}/user/${address}/trades?limit=${limit}`);
            if (!response.ok) throw new Error('Failed to fetch trades');
            const data = await response.json();
            if (data.success) {
                return data.data;
            }
            throw new Error(data.error || 'Unknown error');
        },
        enabled: !!address,
        refetchInterval: 10000, // Auto-refresh every 10s
        staleTime: 5000,
    });

    return { trades, loading, error: err ? (err as Error).message : null, refetch };
}

export function useBackendPositions() {
    const { address } = useAccount();
    const [positions, setPositions] = useState<BackendPosition[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchPositions = useCallback(async () => {
        if (!address) return;
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/user/${address}/positions`);
            if (!response.ok) throw new Error('Failed to fetch positions');
            const data = await response.json();
            if (data.success) {
                setPositions(data.data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [address]);

    useEffect(() => {
        if (address) fetchPositions();
        else setPositions([]);
    }, [address, fetchPositions]);

    return { positions, loading, refetch: fetchPositions };
}

export function useBackendStats() {
    const {
        data: stats,
        isLoading: loading,
        error: err,
        refetch,
    } = useQuery({
        queryKey: ['backend', 'stats'],
        queryFn: async (): Promise<ProtocolStats | null> => {
            const response = await fetch(`${API_BASE_URL}/stats`);
            const data = await response.json().catch(() => ({ success: false }));
            if (data.success) return data.data;
            if (data.data) return data.data;
            throw new Error(data.error || 'Failed to fetch stats');
        },
        staleTime: STALE_MS,
    });

    return {
        stats: stats ?? null,
        loading,
        error: err ? (err as Error).message : null,
        refetch,
    };
}

export interface InsuranceClaimItem {
    id: string;
    claimId: string;
    positionId: string;
    amount: string;
    amountUsd: string;
    submittedAt: string;
    coveredAt: string | null;
    txHash: string;
}

export function useInsuranceClaims(limit = 20) {
    const [claims, setClaims] = useState<InsuranceClaimItem[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchClaims = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/insurance/claims?limit=${limit}`);
            const data = await response.json().catch(() => ({ success: false, data: [] }));
            setClaims(Array.isArray(data.data) ? data.data : []);
        } catch (err) {
            console.error(err);
            setClaims([]);
        } finally {
            setLoading(false);
        }
    }, [limit]);

    useEffect(() => {
        fetchClaims();
    }, [fetchClaims]);

    return { claims, loading, refetch: fetchClaims };
}

export interface LeaderboardEntry {
    rank: number;
    wallet: string;
    pnl: string;
    volume: string;
    trades: number;
}

export interface DailyStat {
    date: string;
    volume: string;
    trades: number;
    fees: string;
    pnl: string;
}

export function useDailyStats() {
    const { data: stats = [], isLoading: loading, error: err, refetch } = useQuery({
        queryKey: ['backend', 'stats', 'history'],
        queryFn: async (): Promise<DailyStat[]> => {
            const response = await fetch(`${API_BASE_URL}/stats/history`);
            const data = await response.json().catch(() => ({ success: false }));
            if (!data.success) throw new Error(data.error || 'Failed to fetch history');
            return Array.isArray(data.data) ? data.data : [];
        },
        staleTime: STALE_MS,
    });
    return { stats, loading, error: err ? (err as Error).message : null, refetch };
}

export function useLeaderboard(limit = 10, timeframe = 'all') {
    const { data: entries = [], isLoading: loading, error: err, refetch } = useQuery({
        queryKey: ['backend', 'leaderboard', limit, timeframe],
        queryFn: async (): Promise<LeaderboardEntry[]> => {
            const response = await fetch(`${API_BASE_URL}/leaderboard?limit=${limit}&timeframe=${timeframe}`);
            const data = await response.json().catch(() => ({ success: false }));
            if (!data.success) throw new Error(data.error || 'Failed to fetch leaderboard');
            return Array.isArray(data.data) ? data.data : [];
        },
        staleTime: STALE_MS,
    });
    return { entries, loading, error: err ? (err as Error).message : null, refetch };
}

export function useMarkets() {
    const {
        data: markets = [],
        isLoading: loading,
        error: err,
        refetch,
    } = useQuery({
        queryKey: ['backend', 'markets'],
        queryFn: async (): Promise<BackendMarket[]> => {
            const response = await fetch(`${API_BASE_URL}/markets`);
            const data = await response.json().catch(() => ({ success: false, data: [] }));
            if (!response.ok) throw new Error(data.error || 'Failed to fetch markets');
            if (!Array.isArray(data.data) || data.data.length === 0) return PLACEHOLDER_MARKETS;
            return (data.data as BackendMarket[]).sort((a, b) => {
                if (a.symbol === 'CFX-USD') return -1;
                if (b.symbol === 'CFX-USD') return 1;
                return 0;
            });

        },
        placeholderData: PLACEHOLDER_MARKETS,
        staleTime: 500,
        refetchInterval: MARKETS_POLL_MS,
        refetchIntervalInBackground: true,
    });

    return {
        markets,
        loading,
        error: err ? (err as Error).message : null,
        refetch,
    };
}

export function useReferralCode() {
    const { address } = useAccount();
    const [code, setCode] = useState<string | null>(null);

    useEffect(() => {
        if (address) {
            const shortFn = address.slice(2, 8).toUpperCase();
            setCode(shortFn);
        } else {
            setCode(null);
        }
    }, [address]);

    return { code, link: code ? `${window.location.origin}/?ref=${code}` : null };
}

export function useReferralStats() {
    const { address } = useAccount();

    const { data: stats, isLoading: loading, error } = useQuery({
        queryKey: ['backend', 'referrals', address],
        queryFn: async () => {
            if (!address) return null;
            const response = await fetch(`${API_BASE_URL}/referrals/stats?address=${address}`);
            const data = await response.json().catch(() => ({ success: false }));
            if (!data.success) return { referees: 0, totalEarned: 0, pendingClaim: 0, code: address.slice(2, 8).toUpperCase() };
            return data.data;
        },
        enabled: !!address,
        staleTime: STALE_MS,
    });

    return {
        stats: stats || { referees: 0, totalEarned: 0, pendingClaim: 0, code: address ? address.slice(2, 8).toUpperCase() : '...' },
        loading,
        error
    };
}


