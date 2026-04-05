import { useState, useEffect, useCallback } from 'react';

const HERMES_BASE = 'https://hermes.pyth.network';

interface PricePoint {
    time: number; // Unix timestamp
    open: number;
    high: number;
    low: number;
    close: number;
}

function parsePythPrice(priceStr: string, expo: number): number {
    const p = Number(priceStr);
    if (!Number.isFinite(p)) return 0;
    return p * Math.pow(10, expo);
}

/**
 * Fetches historical price data from Pyth Network for charting.
 * Uses the Hermes API to fetch prices at specific timestamps.
 * 
 * @param feedId - Pyth feed ID (e.g., 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43 for BTC)
 * @param interval - Interval in minutes between data points (default: 60 = 1 hour)
 * @param points - Number of data points to fetch (default: 24 = 24 hours of hourly data)
 */
export function usePythPriceHistory(
    feedId: string | undefined,
    interval: number = 60,
    points: number = 24
) {
    const [data, setData] = useState<PricePoint[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchHistory = useCallback(async () => {
        if (!feedId) {
            setData([]);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const id = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
            const now = Math.floor(Date.now() / 1000);
            const intervalSeconds = interval * 60;
            const pricePoints: PricePoint[] = [];

            const timestamps: number[] = [];
            for (let i = points - 1; i >= 0; i--) {
                timestamps.push(now - i * intervalSeconds);
            }

            const batchSize = 3;

            for (let batchStart = 0; batchStart < timestamps.length; batchStart += batchSize) {
                const batch = timestamps.slice(batchStart, batchStart + batchSize);

                const batchResults = await Promise.all(
                    batch.map(async (timestamp) => {
                        try {
                            const url = `${HERMES_BASE}/v2/updates/price/${timestamp}?ids[]=${id}`;
                            const res = await fetch(url);
                            if (!res.ok) return null;
                            const json = await res.json();
                            const parsed = json?.parsed?.[0];
                            if (!parsed?.price) return null;

                            const { price: p, expo } = parsed.price;
                            const priceValue = parsePythPrice(String(p), Number(expo));

                            if (priceValue > 0) {
                                return {
                                    time: timestamp,
                                    price: priceValue
                                };
                            }
                            return null;
                        } catch {
                            return null;
                        }
                    })
                );

                batchResults.forEach((result) => {
                    if (result && result.price > 0) {
                        pricePoints.push({
                            time: result.time,
                            open: result.price,
                            high: result.price,
                            low: result.price,
                            close: result.price,
                        });
                    }
                });

                if (batchStart + batchSize < timestamps.length) {
                    await new Promise((resolve) => setTimeout(resolve, 400));
                }
            }

            pricePoints.sort((a, b) => a.time - b.time);
            const ohlcData: PricePoint[] = pricePoints.map((point, idx) => {
                const prevPrice = idx > 0 ? pricePoints[idx - 1]!.close : point.close;
                const nextEl = pricePoints[idx + 1];
                const nextPrice = nextEl ? nextEl.close : point.close;
                const priceDiff = Math.abs(point.close - prevPrice);
                const variance = Math.max(priceDiff * 0.5, point.close * 0.002);

                const high = Math.max(prevPrice, point.close, nextPrice) + variance;
                const low = Math.min(prevPrice, point.close, nextPrice) - variance;

                return {
                    time: point.time,
                    open: prevPrice,
                    high: high,
                    low: low,
                    close: point.close,
                };
            });

            setData(ohlcData);

            if (ohlcData.length === 0) {
                setError('No price data available for this market');
            }
        } catch (err) {
            console.error('[PythHistory] Fetch error:', err);
            setError('Failed to fetch price history');
            setData([]);
        } finally {
            setLoading(false);
        }
    }, [feedId, interval, points]);

    useEffect(() => {
        fetchHistory();
        const t = feedId ? setInterval(fetchHistory, 5 * 60 * 1000) : undefined;
        return () => {
            if (t) clearInterval(t);
        };
    }, [feedId, fetchHistory]);

    return { data, loading, error, refetch: fetchHistory };
}
