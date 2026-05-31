import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { getApiBaseUrl } from '../config/api';

// Social router is mounted at /api/v1/social; API_BASE already ends in `/api`.
const SOCIAL_BASE = `${getApiBaseUrl()}/v1/social`;
const STALE_MS = 30_000;

export interface LeadTrader {
    address: string;
    profitFeeBps: number;
    metadataURI: string;
    activeFollowers: number;
    totalPnl: string;
    roi: number;
    winRate: number;
    totalTrades: number;
}

export interface FollowedTrader {
    address: string;
    maxAllocation: string;
    maxLeverage: number;
    startedAt: string;
    copiedPnl: string;
}

export interface CopierPnl {
    totalCopiedPnl: string;
    pnlByTrader: Record<string, string>;
    copierAddress: string;
}

/**
 * `null` when the backend signals copy-trading isn't provisioned (HTTP 501/503)
 * so the UI can show an honest "feature unavailable" state instead of an error.
 */
async function fetchOrNull<T>(url: string): Promise<T | null> {
    let res: Response;
    try {
        res = await fetch(url);
    } catch {
        return null;
    }
    if (res.status === 501 || res.status === 503) return null;
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.json()) as T;
}

/** Top lead traders available to copy. Returns [] when none / feature off. */
export function useTopTraders() {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['social', 'top-traders'],
        queryFn: async (): Promise<LeadTrader[]> => {
            const body = await fetchOrNull<{ traders?: LeadTrader[] }>(`${SOCIAL_BASE}/top-traders`);
            return Array.isArray(body?.traders) ? body!.traders : [];
        },
        staleTime: STALE_MS,
        refetchInterval: 60_000,
    });

    return {
        traders: data ?? [],
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refetch,
    };
}

/** Traders the connected wallet is currently copying. */
export function useFollowing() {
    const { address } = useAccount();

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['social', 'following', address],
        queryFn: async (): Promise<FollowedTrader[]> => {
            if (!address) return [];
            const body = await fetchOrNull<{ following?: FollowedTrader[] }>(
                `${SOCIAL_BASE}/copier/${address}/following`,
            );
            return Array.isArray(body?.following) ? body!.following : [];
        },
        enabled: !!address,
        staleTime: STALE_MS,
        refetchInterval: 30_000,
    });

    return {
        following: data ?? [],
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refetch,
    };
}

/** Aggregated copied PnL for the connected wallet, by lead trader. */
export function useCopierPnl() {
    const { address } = useAccount();

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['social', 'copier-pnl', address],
        queryFn: async (): Promise<CopierPnl | null> => {
            if (!address) return null;
            return fetchOrNull<CopierPnl>(`${SOCIAL_BASE}/copier/${address}/pnl`);
        },
        enabled: !!address,
        staleTime: STALE_MS,
        refetchInterval: 30_000,
    });

    return {
        pnl: data ?? null,
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refetch,
    };
}
