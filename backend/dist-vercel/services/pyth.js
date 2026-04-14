"use strict";
/**
 * Pyth Hermes (real-time) and Benchmarks (history) for prices and charts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PYTH_FEED_BY_MARKET = void 0;
exports.fetchPythPrices = fetchPythPrices;
exports.getPythFeedId = getPythFeedId;
exports.getPythTvSymbol = getPythTvSymbol;
exports.fetchPyth24hChange = fetchPyth24hChange;
exports.fetchPythPriceHistory = fetchPythPriceHistory;
exports.fetchPythPriceHistoryHermes = fetchPythPriceHistoryHermes;
const HERMES_BASE = "https://hermes.pyth.network";
const BENCHMARKS_BASE = "https://benchmarks.pyth.network";
const CACHE_MS = 1_000; // 1s for live prices (trading protocol)
// Market address (lowercase) -> Pyth price feed ID (hex with 0x)
exports.PYTH_FEED_BY_MARKET = {
    "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": "0x8879170230c9603342f3837cf9a8e76c61791198fb1271bb2552c9af7b33c933",
    "0x986a383f6de4a24dd3f524f0f93546229b58265f": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    "0x886a383f6de4a24dd3f524f0f93546229b58265f": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    "0x286a383f6de4a24dd3f524f0f93546229b58265f": "0x44465e17d2e9d390e70c999d5a11fda4f092847fcd2e3e5aa089d96c98a30e67",
    "0x786a383f6de4a24dd3f524f0f93546229b58265f": "0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f",
    "0x686a383f6de4a24dd3f524f0f93546229b58265f": "0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
    "0x586a383f6de4a24dd3f524f0f93546229b58265f": "0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900",
    "0x486a383f6de4a24dd3f524f0f93546229b58265f": "0xc13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758",
    "0x386a383f6de4a24dd3f524f0f93546229b58265f": "0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e",
    "0x946a383f6de4a24dd3f524f0f93546229b58265f": "0x02a67e6184e6c9dd65e14745a2a80df8b2b3d2ca91b4b191404936003d9929ae",
    "0x956a383f6de4a24dd3f524f0f93546229b58265f": "0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
    "0x966a383f6de4a24dd3f524f0f93546229b58265f": "0x641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f",
    "0x976a383f6de4a24dd3f524f0f93546229b58265f": "0x27cac3c00ed32285b8686611bbc4a654279c1ea11ab4dc90822c2edd20734bca",
    "0x006a383f6de4a24dd3f524f0f93546229b58265f": "0xdd49a9ac6df5cbfa9d8fc6371f7ae927a74d5c6763c1c01b4220d70314c647f9",
    "0x116a383f6de4a24dd3f524f0f93546229b58265f": "0x53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28",
    "0x706a383f6de4a24dd3f524f0f93546229b58265f": "0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14",
};
// Market address -> Pyth Benchmarks TradingView symbol (for history API)
const MARKET_TO_TV_SYMBOL = {
    "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": "Crypto.CFX/USD",
    "0x986a383f6de4a24dd3f524f0f93546229b58265f": "Crypto.BTC/USD",
    "0x886a383f6de4a24dd3f524f0f93546229b58265f": "Crypto.ETH/USD",
    "0x286a383f6de4a24dd3f524f0f93546229b58265f": "Crypto.XAUT/USD",
    "0x786a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.NVDA/USD",
    "0x686a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.TSLA/USD",
    "0x586a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.META/USD",
    "0x486a383f6de4a24dd3f524f0f93546229b58265f": "Crypto.USDC/USD",
    "0x386a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.GOOGL/USD",
    "0x946a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.NFLX/USD",
    "0x956a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.AAPL/USD",
    "0x966a383f6de4a24dd3f524f0f93546229b58265f": "Crypto.COINX/USD",
    "0x976a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.MCD/USD",
    "0x006a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.HOOD/USD",
    "0x116a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.MSTR/USD",
    "0x706a383f6de4a24dd3f524f0f93546229b58265f": "Equity.US.SPY/USD",
};
let cachedAt = 0;
let cachedPrices = {};
function parsePythPrice(priceStr, expo) {
    const p = Number(priceStr);
    if (!Number.isFinite(p))
        return 0;
    return p * Math.pow(10, expo);
}
/** Fetch latest Pyth prices for all known markets (Hermes batch). */
async function fetchPythPrices() {
    if (Date.now() - cachedAt < CACHE_MS && Object.keys(cachedPrices).length > 0) {
        return cachedPrices;
    }
    const feedIds = [...new Set(Object.values(exports.PYTH_FEED_BY_MARKET))];
    const idsParam = feedIds.map((id) => `ids[]=${id.startsWith("0x") ? id.slice(2) : id}`).join("&");
    const url = `${HERMES_BASE}/v2/updates/price/latest?${idsParam}`;
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok)
            return cachedPrices;
        const data = (await res.json());
        const parsed = data?.parsed ?? [];
        const byFeedId = {};
        for (const item of parsed) {
            if (item.price) {
                const norm = parsePythPrice(String(item.price.price), item.price.expo);
                if (norm > 0)
                    byFeedId[item.id] = norm;
            }
        }
        const byMarket = {};
        for (const [addr, feedId] of Object.entries(exports.PYTH_FEED_BY_MARKET)) {
            const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
            if (byFeedId[id])
                byMarket[addr] = byFeedId[id];
        }
        cachedPrices = byMarket;
        cachedAt = Date.now();
        return byMarket;
    }
    catch (e) {
        console.warn("[pyth] Hermes fetch failed:", e);
        return cachedPrices;
    }
}
function getPythFeedId(marketAddress) {
    return exports.PYTH_FEED_BY_MARKET[marketAddress.toLowerCase()];
}
function getPythTvSymbol(marketAddress) {
    return MARKET_TO_TV_SYMBOL[marketAddress.toLowerCase()] ?? null;
}
/** Compute 24h price change % from Pyth (current vs ~24h ago). */
async function fetchPyth24hChange(marketAddress) {
    const addr = marketAddress.toLowerCase();
    const symbol = getPythTvSymbol(marketAddress);
    if (!symbol)
        return undefined;
    const [prices, history] = await Promise.all([fetchPythPrices(), fetchPythPriceHistory(marketAddress, 2)]);
    const current = prices[addr];
    if (!current || current <= 0 || !history.length)
        return undefined;
    const target24h = Date.now() - 24 * 60 * 60 * 1000;
    let best = null;
    let bestDiff = Infinity;
    for (const p of history) {
        const diff = Math.abs(p.timestamp - target24h);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = p;
        }
    }
    if (!best || best.value <= 0)
        return undefined;
    return ((current - best.value) / best.value) * 100;
}
/** Pyth Benchmarks TradingView history: returns { timestamp, value }[] for sparklines. */
async function fetchPythPriceHistory(marketAddress, days = 7) {
    const symbol = getPythTvSymbol(marketAddress);
    if (!symbol)
        return [];
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 24 * 3600;
    const url = `${BENCHMARKS_BASE}/v1/shims/tradingview/history?symbol=${encodeURIComponent(symbol)}&resolution=60&from=${from}&to=${to}`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4_000);
        const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok)
            return [];
        const data = (await res.json());
        if (data.s !== "ok" || !Array.isArray(data.t) || !Array.isArray(data.c))
            return [];
        return data.t.map((t, i) => ({ timestamp: t * 1000, value: data.c[i] ?? 0 }));
    }
    catch (e) {
        console.warn("[pyth] Benchmarks history failed:", symbol, e);
        return [];
    }
}
/** Hermes fallback: fetch historical prices at intervals when Benchmarks fails. */
async function fetchPythPriceHistoryHermes(marketAddress, days = 7, points = 24) {
    const feedId = getPythFeedId(marketAddress);
    if (!feedId)
        return [];
    const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
    const now = Math.floor(Date.now() / 1000);
    const intervalSeconds = Math.floor((days * 24 * 3600) / (points - 1));
    const pricePoints = [];
    for (let i = points - 1; i >= 0; i--) {
        const ts = now - i * intervalSeconds;
        try {
            const url = `${HERMES_BASE}/v2/updates/price/${ts}?ids[]=${id}`;
            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (!res.ok)
                continue;
            const json = (await res.json());
            const parsed = json?.parsed?.[0];
            if (!parsed?.price)
                continue;
            const value = parsePythPrice(String(parsed.price.price), parsed.price.expo);
            if (value > 0)
                pricePoints.push({ timestamp: ts * 1000, value });
        }
        catch {
            /* skip failed point */
        }
        if (i > 0)
            await new Promise((r) => setTimeout(r, 100));
    }
    return pricePoints.sort((a, b) => a.timestamp - b.timestamp);
}
