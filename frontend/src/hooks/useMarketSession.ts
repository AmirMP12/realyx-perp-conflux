import { useEffect, useState } from 'react';
import { getMarketSession, type MarketSession } from '../utils/marketHours';

/**
 * Live market-session state for a given asset category. Re-evaluates every
 * `intervalMs` (default 30s) so the countdown ("Reopens in 14h 22m") and the
 * open/closed badge stay current without a full data refetch.
 */
export function useMarketSession(category?: string, intervalMs = 30_000): MarketSession {
    const [session, setSession] = useState<MarketSession>(() => getMarketSession(category));

    useEffect(() => {
        setSession(getMarketSession(category));
        const id = setInterval(() => setSession(getMarketSession(category)), intervalMs);
        return () => clearInterval(id);
    }, [category, intervalMs]);

    return session;
}
