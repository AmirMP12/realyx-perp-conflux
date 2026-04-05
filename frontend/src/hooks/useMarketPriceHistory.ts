import { useQuery } from '@tanstack/react-query';

import { getApiBaseUrl } from '../config/api';

const API_BASE = getApiBaseUrl();

export interface PricePoint {
  timestamp: number;
  value: number;
}

export function useMarketPriceHistory(marketAddress: string | undefined, days = 7) {
  const { data: prices = [], isLoading, error } = useQuery({
    queryKey: ['marketPriceHistory', (marketAddress ?? '').toLowerCase(), days],
    queryFn: async (): Promise<PricePoint[]> => {
      if (!marketAddress) return [];
      const res = await fetch(
        `${API_BASE}/markets/price-history/${encodeURIComponent(marketAddress)}?days=${days}`
      );
      const json = await res.json().catch(() => ({ success: false, data: [] }));
      if (!json.success || !Array.isArray(json.data)) return [];
      return json.data;
    },
    enabled: !!marketAddress,
    staleTime: 60_000,
  });
  return { prices, loading: isLoading, error };
}
