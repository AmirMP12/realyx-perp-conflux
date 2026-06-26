import { useEffect, useMemo, useRef, useState } from 'react';
import { usePythDisplayPrice, getPythFeedId } from './usePythPrice';

/**
 * Centralized price resolution for a single market.
 *
 * Replaces the ad-hoc `currentPrice` fallback logic that was duplicated across
 * `Trading.tsx` and `Markets.tsx`. Resolves a single authoritative display
 * price using an explicit priority chain and tracks freshness:
 *
 *   Priority:  Pyth (Hermes)  →  on-chain contract/oracle  →  backend API
 *
 * The hook is intentionally presentation-only: it does not place orders or
 * drive on-chain risk math. For authoritative open-position risk the UI should
 * still read `getAccountRisk` / `getPositionPnL` (see `useAccountRisk`).
 */

export type PriceSource = 'pyth' | 'contract' | 'api' | 'none';

export interface PriceFeed {
    /** Best available price, 0 when nothing is resolvable yet. */
    price: number;
    /** Which tier supplied `price`. */
    source: PriceSource;
    /** Milliseconds since `price` last changed (freshness, not wall-clock fetch age). */
    ageMs: number;
    /** True once `ageMs` exceeds `staleAfterMs` (or when no source is available). */
    isStale: boolean;
    /** True while the primary (Pyth) source is still doing its first fetch. */
    isLoading: boolean;
    /** Force an immediate Pyth refresh (e.g. right before submitting an order). */
    refresh: () => Promise<void> | void;
}

export interface PriceFeedInput {
    /** Market contract address (used to resolve the Pyth feed id). */
    marketAddress?: string;
    /** Market symbol, used as a Pyth feed-id fallback. */
    symbol?: string;
    /** Latest on-chain/oracle price if already read by the caller (tier 2). */
    contractPrice?: number | null;
    /** Backend/API index price (tier 3). */
    apiPrice?: number | null;
}

export interface PriceFeedOptions {
    /** A resolved price older than this (ms) is reported as stale. Default 10s. */
    staleAfterMs?: number;
    /** Disable the Pyth poll (e.g. when off-screen). Tier 2/3 still resolve. */
    enabled?: boolean;
}

const DEFAULT_STALE_AFTER_MS = 10_000;

function isPositive(n: number | null | undefined): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export function usePriceFeed(input: PriceFeedInput, options: PriceFeedOptions = {}): PriceFeed {
    const { marketAddress, symbol, contractPrice, apiPrice } = input;
    const { staleAfterMs = DEFAULT_STALE_AFTER_MS, enabled = true } = options;

    const feedId = useMemo(
        () => (enabled ? getPythFeedId(marketAddress ?? '', symbol) : undefined),
        [enabled, marketAddress, symbol],
    );

    const { price: pythPrice, loading: pythLoading, refetch } = usePythDisplayPrice(feedId);

    // Resolve the winning tier in strict priority order.
    const { price, source } = useMemo<{ price: number; source: PriceSource }>(() => {
        if (isPositive(pythPrice)) return { price: pythPrice, source: 'pyth' };
        if (isPositive(contractPrice)) return { price: contractPrice, source: 'contract' };
        if (isPositive(apiPrice)) return { price: apiPrice, source: 'api' };
        return { price: 0, source: 'none' };
    }, [pythPrice, contractPrice, apiPrice]);

    // Track when the resolved value last *changed* so `ageMs` reflects real
    // freshness rather than render cadence.
    const lastChangeRef = useRef<number>(Date.now());
    const lastPriceRef = useRef<number>(price);
    if (price !== lastPriceRef.current && price > 0) {
        lastPriceRef.current = price;
        lastChangeRef.current = Date.now();
    }

    // Re-render on an interval so `ageMs`/`isStale` advance even without new
    // prices (important for the "price is stale" UI badge).
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1_000);
        return () => clearInterval(t);
    }, []);

    const ageMs = source === 'none' ? Infinity : Date.now() - lastChangeRef.current;
    const isStale = source === 'none' || ageMs > staleAfterMs;

    return {
        price,
        source,
        ageMs,
        isStale,
        isLoading: pythLoading && source === 'none',
        refresh: refetch,
    };
}
