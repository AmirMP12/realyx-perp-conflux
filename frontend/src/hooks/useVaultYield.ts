import { useQuery } from '@tanstack/react-query';
import { getApiBaseUrl } from '../config/api';

const API_BASE_URL = getApiBaseUrl();

export interface VaultYieldSource {
    key: 'borrowFees' | 'funding' | 'liquidations';
    label: string;
    amountUsd: number;
    apr: number;
}

export interface VaultYield {
    tvl: number;
    windowDays: number;
    totalApr: number;
    sources: VaultYieldSource[];
    history: Array<{ date: string; apr: number; feesUsd: number }>;
    estimated: boolean;
}

const EMPTY: VaultYield = { tvl: 0, windowDays: 30, totalApr: 0, sources: [], history: [], estimated: true };

/**
 * Real-yield breakdown for LPs: APR split by source (borrow/trading fees,
 * funding, liquidations) plus a 30d historical APR curve, from the backend
 * `/vault/yield` endpoint. Clearly an estimate (the `estimated` flag), faithful
 * to the indexed event stream.
 */
export function useVaultYield() {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['backend', 'vault', 'yield'],
        queryFn: async (): Promise<VaultYield> => {
            const res = await fetch(`${API_BASE_URL}/vault/yield`);
            const body = await res.json().catch(() => ({ success: false }));
            if (!body.success || !body.data) return EMPTY;
            return body.data as VaultYield;
        },
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

    return {
        yield: data ?? EMPTY,
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refetch,
    };
}
