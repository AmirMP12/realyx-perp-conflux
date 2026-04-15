/**
 * CoinGecko API for real-time prices and 24h change.
 * Used to enrich markets with indexPrice and change24h when subgraph has no positions.
 */
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const CACHE_MS = 60_000; // 1 min
// Map market address (lowercase) to CoinGecko API id
export const MARKET_TO_COINGECKO_ID = {
    "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": "conflux-token",
    "0x986a383f6de4a24dd3f524f0f93546229b58265f": "bitcoin",
    "0x886a383f6de4a24dd3f524f0f93546229b58265f": "ethereum",
    "0x286a383f6de4a24dd3f524f0f93546229b58265f": "tether-gold",
    "0x786a383f6de4a24dd3f524f0f93546229b58265f": "nvidia-xstock",
    "0x686a383f6de4a24dd3f524f0f93546229b58265f": "tesla-xstock",
    "0x586a383f6de4a24dd3f524f0f93546229b58265f": "meta-xstock",
    "0x486a383f6de4a24dd3f524f0f93546229b58265f": "usd-coin",
    "0x386a383f6de4a24dd3f524f0f93546229b58265f": "alphabet-xstock",
    "0x946a383f6de4a24dd3f524f0f93546229b58265f": "netflix-xstock",
    "0x956a383f6de4a24dd3f524f0f93546229b58265f": "apple-xstock",
    "0x966a383f6de4a24dd3f524f0f93546229b58265f": "coinbase-xstock",
    "0x976a383f6de4a24dd3f524f0f93546229b58265f": "mcdonald-s-xstock",
    "0x006a383f6de4a24dd3f524f0f93546229b58265f": "robinhood-xstock",
    "0x116a383f6de4a24dd3f524f0f93546229b58265f": "microstrategy-xstock",
    "0x706a383f6de4a24dd3f524f0f93546229b58265f": "spdr-s-p-500-etf-ondo-tokenized-etf",
};
let cachedAt = 0;
let cachedData = {};
export async function fetchCoinGeckoPrices() {
    if (Date.now() - cachedAt < CACHE_MS && Object.keys(cachedData).length > 0) {
        return cachedData;
    }
    const ids = [...new Set(Object.values(MARKET_TO_COINGECKO_ID))].join(",");
    const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok)
            return cachedData;
        const list = await res.json();
        const out = {};
        for (const entry of list) {
            out[entry.id] = {
                price: entry.current_price ?? 0,
                change24h: entry.price_change_percentage_24h ?? 0,
                volume24h: typeof entry.total_volume === "number" ? entry.total_volume : undefined,
            };
        }
        cachedData = out;
        cachedAt = Date.now();
        return out;
    }
    catch (e) {
        console.warn("[coingecko] fetch failed:", e);
        return cachedData;
    }
}
export function getCoinGeckoIdForMarket(marketAddress) {
    return MARKET_TO_COINGECKO_ID[marketAddress.toLowerCase()] ?? null;
}
/** Price history for charts: array of [timestamp_ms, price] */
export async function fetchPriceHistory(coingeckoId, days = 7) {
    const url = `${COINGECKO_BASE}/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`;
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok)
            return [];
        const data = (await res.json());
        const prices = data.prices ?? [];
        return prices.map(([t, value]) => ({ timestamp: t, value }));
    }
    catch (e) {
        console.warn("[coingecko] price history failed:", coingeckoId, e);
        return [];
    }
}
