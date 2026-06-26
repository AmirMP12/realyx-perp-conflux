import { useQuery } from '@tanstack/react-query';
import { binanceFundingSymbol } from '../utils/fundingCompare';

/**
 * Fetch the latest funding rate for the equivalent Binance USDⓈ-M perp as a
 * neutral, well-known reference to compare Realyx funding against. Returns the
 * rate as an 8h fraction (Binance funds every 8h, matching our interval), or
 * null when there is no CEX perp for the asset (equities, commodities).
 *
 * Public endpoint, no key required. Failures resolve to null so the UI simply
 * shows "no reference" rather than erroring.
 */
export function useReferenceFunding(marketSymbol: string | undefined) {
    const binanceSymbol = binanceFundingSymbol(marketSymbol);

    const { data, isLoading } = useQuery({
        queryKey: ['reference-funding', binanceSymbol],
        enabled: Boolean(binanceSymbol),
        staleTime: 60_000,
        refetchInterval: 120_000,
        queryFn: async (): Promise<number | null> => {
            if (!binanceSymbol) return null;
            try {
                const res = await fetch(
                    `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`,
                    { signal: AbortSignal.timeout(6000) },
                );
                if (!res.ok) return null;
                const json = await res.json();
                const rate = parseFloat(json?.lastFundingRate);
                return Number.isFinite(rate) ? rate : null;
            } catch {
                return null;
            }
        },
    });

    return {
        referenceRate8h: data ?? null,
        hasReference: Boolean(binanceSymbol),
        loading: isLoading,
    };
}
