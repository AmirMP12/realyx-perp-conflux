import { ethers } from "ethers";
import { withProvider, getRpcUrls } from "./rpcPool.js";
import { logger } from "../logger.js";

function getTradingCoreAbi(): any[] {
  return [
    "function activeMarketCount() view returns (uint256)",
    "function activeMarketAt(uint256 index) view returns (address)",
  ];
}

function activeFilterEnabled(): boolean {
  if (process.env.ENABLE_ACTIVE_MARKETS_FILTER != null) {
    return /^(1|true|yes)$/i.test(process.env.ENABLE_ACTIVE_MARKETS_FILTER);
  }
  // Enabled by default; set ENABLE_ACTIVE_MARKETS_FILTER=false to skip the
  // per-request on-chain filtering and its RPC calls.
  return true;
}

async function fetchActiveSet(tradingCoreAddress: string): Promise<Set<string>> {
  return withProvider(async (provider) => {
    const contract = new ethers.Contract(tradingCoreAddress, getTradingCoreAbi(), provider);
    const count = await contract.activeMarketCount();
    const n = Number(count);
    // Fetch all addresses in parallel instead of sequentially
    const addrPromises = Array.from({ length: n }, (_, i) => contract.activeMarketAt(i));
    const addrs: string[] = await Promise.all(addrPromises);
    const set = new Set<string>();
    for (const addr of addrs) {
      if (addr && typeof addr === "string") set.add(addr.toLowerCase());
    }
    return set;
  });
}

// ── In-memory cache for active market addresses ──
const ACTIVE_CACHE_TTL_MS = 30_000; // 30s — market list rarely changes
let cachedActiveSet: Set<string> | null = null;
let cachedActiveAt = 0;

export async function getActiveMarketAddresses(): Promise<Set<string> | null> {
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
    logger.warn("[activeMarkets] Filter disabled: RPC_URL or TRADING_CORE_ADDRESS not set in env");
    return null;
  }

  try {
    const set = await fetchActiveSet(tradingCoreAddress);
    cachedActiveSet = set;
    cachedActiveAt = Date.now();
    return set;
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[activeMarkets] RPC call failed (all endpoints)");
    return null;
  }
}

