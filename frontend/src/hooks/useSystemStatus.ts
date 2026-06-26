import { useQuery } from '@tanstack/react-query';
import { getApiBaseUrl } from '../config/api';

const API_BASE_URL = getApiBaseUrl();

export type Health = 'operational' | 'degraded' | 'down';

export interface StatusComponent {
    key: string;
    label: string;
    status: Health;
    detail?: string;
    latencyMs?: number;
}

export interface SystemStatus {
    status: Health;
    uptimeSeconds: number;
    ts: string;
    components: StatusComponent[];
    vault: {
        tvl: number;
        insuranceFund: number;
        insuranceHealthPct: number;
        availableLiquidity: number;
        solvencyRatio: number | null;
        insuranceHealthy: boolean;
    };
}

/**
 * Public transparency feed — overall status, per-component health (oracle, RPC,
 * indexer, vault), uptime, and vault solvency / insurance fund — from the
 * backend `/status` endpoint. Powers the public status page.
 */
export function useSystemStatus() {
    const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
        queryKey: ['backend', 'status'],
        queryFn: async (): Promise<SystemStatus | null> => {
            const res = await fetch(`${API_BASE_URL}/status`);
            const body = await res.json().catch(() => ({ success: false }));
            if (!body.success || !body.data) return null;
            return body.data as SystemStatus;
        },
        staleTime: 15_000,
        refetchInterval: 30_000,
    });

    return {
        status: data ?? null,
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refetch,
        updatedAt: dataUpdatedAt,
    };
}
