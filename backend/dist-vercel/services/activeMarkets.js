import { ethers } from "ethers";
function getTradingCoreAbi() {
    return [
        "function activeMarketCount() view returns (uint256)",
        "function activeMarketAt(uint256 index) view returns (address)",
    ];
}
const DEFAULT_TESTNET_RPCS = [
    "https://evmtestnet.confluxrpc.com",
    "https://evmtestnet.confluxrpc.org",
];
const DEFAULT_MAINNET_RPCS = ["https://evm.confluxrpc.com"];
function getRpcUrls() {
    const primary = (process.env.RPC_URL ?? "").trim();
    const fallbackEnv = (process.env.RPC_FALLBACK_URL ?? "").trim();
    const urls = primary ? [primary] : [];
    if (fallbackEnv && !urls.includes(fallbackEnv))
        urls.push(fallbackEnv);
    const chainId = process.env.CHAIN_ID ?? "71";
    const defaults = chainId === "1030" ? DEFAULT_MAINNET_RPCS : DEFAULT_TESTNET_RPCS;
    if (!primary || chainId === "71" || chainId === "1030") {
        for (const u of defaults)
            if (!urls.includes(u))
                urls.push(u);
    }
    return urls;
}
function activeFilterEnabled() {
    if (process.env.ENABLE_ACTIVE_MARKETS_FILTER != null) {
        return /^(1|true|yes)$/i.test(process.env.ENABLE_ACTIVE_MARKETS_FILTER);
    }
    // In serverless (Vercel), skip on-chain filtering by default to avoid
    // expensive RPC calls on every request.
    return !process.env.VERCEL;
}
async function tryFetchActiveSet(rpcUrl, tradingCoreAddress) {
    const chainId = parseInt(process.env.CHAIN_ID ?? "71", 10);
    const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
    const contract = new ethers.Contract(tradingCoreAddress, getTradingCoreAbi(), provider);
    const count = await contract.activeMarketCount();
    const n = Number(count);
    // Fetch all addresses in parallel instead of sequentially
    const addrPromises = Array.from({ length: n }, (_, i) => contract.activeMarketAt(i));
    const addrs = await Promise.all(addrPromises);
    const set = new Set();
    for (const addr of addrs) {
        if (addr && typeof addr === "string")
            set.add(addr.toLowerCase());
    }
    return set;
}
// ── In-memory cache for active market addresses ──
const ACTIVE_CACHE_TTL_MS = 30_000; // 30s — market list rarely changes
let cachedActiveSet = null;
let cachedActiveAt = 0;
export async function getActiveMarketAddresses() {
    if (!activeFilterEnabled()) {
        return null;
    }
    // Return cached if still fresh
    if (Date.now() - cachedActiveAt < ACTIVE_CACHE_TTL_MS && cachedActiveSet !== null) {
        return cachedActiveSet;
    }
    const tradingCoreAddress = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
    const urls = getRpcUrls();
    if (!urls.length || !tradingCoreAddress) {
        console.warn("[activeMarkets] Filter disabled: RPC_URL or TRADING_CORE_ADDRESS not set in env");
        return null;
    }
    for (const rpcUrl of urls) {
        try {
            const set = await tryFetchActiveSet(rpcUrl, tradingCoreAddress);
            if (set && set.size >= 0) {
                cachedActiveSet = set;
                cachedActiveAt = Date.now();
                return set;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (urls.indexOf(rpcUrl) < urls.length - 1) {
                console.warn("[activeMarkets] RPC failed, trying next:", rpcUrl.slice(0, 40) + "...", msg);
            }
            else {
                console.warn("[activeMarkets] RPC call failed (all endpoints):", msg);
            }
        }
    }
    return null;
}
