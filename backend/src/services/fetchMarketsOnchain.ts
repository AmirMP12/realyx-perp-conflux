import { readFileSync } from "fs";
import { join } from "path";
import { ethers } from "ethers";
import { withProvider, getRpcUrls as poolRpcUrls } from "./rpcPool.js";
import { logger } from "../logger.js";

/** Matches `indexer.Market` for `/markets` route mapping. */
export interface OnchainMarketRow {
  id: string;
  marketAddress: string;
  maxLeverage: string;
  maxPositionSize: string;
  maxTotalExposure: string;
  totalLongSize: string;
  totalShortSize: string;
  totalLongCost: string;
  totalShortCost: string;
  fundingRate: string;
  cumulativeFunding: string;
  lastFundingTime: string;
  longOpenInterest: string;
  shortOpenInterest: string;
  isActive: boolean;
  isListed: boolean;
  updatedAt: string;
}



/** Re-exported from the shared RPC pool so existing imports keep working. */
export function getRpcUrls(): string[] {
  return poolRpcUrls();
}

let cachedAbi: ethers.InterfaceAbi | null = null;

function loadTradingCoreAbi(): ethers.InterfaceAbi {
  if (cachedAbi) return cachedAbi;

  // Resolve the exported ABI across every runtime layout we ship:
  //  - dev / jest         → cwd = backend/, source tree present (src/abi)
  //  - compiled standalone → cwd = backend/, tsc copies imported JSON to dist/abi
  //  - keeper image (root) → cwd = repo root, ABI mirrored under backend/src/abi
  // First existing file wins; a JSON `import` is avoided because ts-jest (CommonJS)
  // and Node ESM (NodeNext) disagree on import attributes.
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "src/abi/TradingCore.json"),
    join(cwd, "dist/abi/TradingCore.json"),
    join(cwd, "backend/dist/abi/TradingCore.json"),
    join(cwd, "backend/src/abi/TradingCore.json"),
  ];

  for (const abiPath of candidates) {
    try {
      const abi = JSON.parse(readFileSync(abiPath, "utf8")) as ethers.InterfaceAbi;
      cachedAbi = abi;
      return abi;
    } catch {
      // Not at this location — try the next candidate.
    }
  }

  throw new Error(
    `TradingCore.json ABI not found. Looked in:\n - ${candidates.join("\n - ")}`,
  );
}

export function toStr(n: unknown): string {
  if (n == null) return "0";
  if (typeof n === "bigint") return n.toString();
  if (typeof n === "number") return Number.isFinite(n) ? String(Math.trunc(n)) : "0";
  return String(n);
}

// ── In-memory cache for on-chain markets data ──
const CACHE_TTL_MS = 10_000; // 10s — frontend polls every 1-5s so this avoids redundant RPC
let cachedMarkets: OnchainMarketRow[] = [];
let cachedAt = 0;
let fetchInProgress: Promise<OnchainMarketRow[]> | null = null;

const BASE_FUNDING_RATE = 100000000000000n; // 1e14
const PRECISION = 1000000000000000000n; // 1e18

export function calculateInstantFundingRate(longOI: bigint, shortOI: bigint): bigint {
  const totalOI = longOI + shortOI;
  if (totalOI === 0n) return 0n;

  if (longOI >= shortOI) {
    const imbalance = ((longOI - shortOI) * PRECISION) / totalOI;
    return (BASE_FUNDING_RATE * imbalance) / PRECISION;
  } else {
    const imbalance = ((shortOI - longOI) * PRECISION) / totalOI;
    return -((BASE_FUNDING_RATE * imbalance) / PRECISION);
  }
}

/**
 * When Postgres markets indexer is empty, load live OI / funding / sizes from TradingCore RPC.
 * Fixes API consumers seeing volume24h / OI / funding all zero without a DB / indexer.
 *
 * Performance: All per-market RPC calls are parallelized and results are cached for 10s.
 */
export async function fetchMarketsOnChain(): Promise<OnchainMarketRow[]> {
  // Return cached if still fresh
  if (Date.now() - cachedAt < CACHE_TTL_MS && cachedMarkets.length > 0) {
    return cachedMarkets;
  }

  // Deduplicate concurrent callers — only one in-flight fetch at a time
  if (fetchInProgress) return fetchInProgress;

  fetchInProgress = _fetchMarketsOnChainImpl();
  try {
    const result = await fetchInProgress;
    return result;
  } finally {
    fetchInProgress = null;
  }
}

export async function _fetchMarketsOnChainImpl(): Promise<OnchainMarketRow[]> {
  const tradingCoreAddress = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
  if (!tradingCoreAddress) return [];

  const urls = getRpcUrls();
  if (urls.length === 0) return [];

  try {
    // Health-based routing + automatic failover across the RPC pool.
    return await withProvider(async (provider) => {
      const abi = loadTradingCoreAbi();
      const tc = new ethers.Contract(tradingCoreAddress, abi, provider);
      const countBn = await tc.activeMarketCount();
      const n = Number(countBn);
      if (!Number.isFinite(n) || n <= 0) return [];

      // Fetch all market addresses in parallel
      const addrPromises = Array.from({ length: n }, (_, i) => tc.activeMarketAt(i));
      const addrs: string[] = await Promise.all(addrPromises);

      // Fetch all getMarketInfo + getFundingState in parallel (2 calls per market, all at once)
      const infoPromises = addrs.map((addr) => tc.getMarketInfo(addr).catch(() => null));
      const fundPromises = addrs.map((addr) => tc.getFundingState(addr).catch(() => null));
      const [infos, funds] = await Promise.all([
        Promise.all(infoPromises),
        Promise.all(fundPromises),
      ]);

      const out: OnchainMarketRow[] = [];
      for (let i = 0; i < addrs.length; i++) {
        const addr = addrs[i];
        if (!addr || typeof addr !== "string") continue;
        const info = infos[i];
        const fund = funds[i];
        if (!info) continue;

        // Calculate live funding rate if the on-chain one is zero (not yet settled)
        // or just always provide a live estimate for consistency.
        // ethers v6 Result objects support both named and indexed access.
        // Fallback to indices if named access returns undefined (e.g. ABI mismatch or RPC quirk).
        const longOI = BigInt(info.totalLongSize ?? info[8] ?? 0);
        const shortOI = BigInt(info.totalShortSize ?? info[9] ?? 0);
        const liveFundingRate = calculateInstantFundingRate(longOI, shortOI);
        const rawFundingRate = toStr(liveFundingRate);

        out.push({
          id: addr.toLowerCase(),
          marketAddress: addr,
          maxLeverage: toStr(info.maxLeverage ?? info[7]),
          maxPositionSize: toStr(info.maxPositionSize ?? info[3]),
          maxTotalExposure: toStr(info.maxTotalExposure ?? info[4]),
          totalLongSize: toStr(longOI),
          totalShortSize: toStr(shortOI),
          totalLongCost: toStr(info.totalLongCost ?? info[10]),
          totalShortCost: toStr(info.totalShortCost ?? info[11]),
          fundingRate: rawFundingRate, // Raw bigint string scaled by 1e18
          cumulativeFunding: fund ? toStr(fund.cumulativeFunding ?? fund[1]) : "0",
          lastFundingTime: fund ? toStr(fund.lastSettlement ?? fund[2]) : "0",
          longOpenInterest: toStr(longOI),
          shortOpenInterest: toStr(shortOI),
          isActive: Boolean(info.isActive ?? info[12]),
          isListed: Boolean(info.isListed ?? info[13]),
          updatedAt: new Date().toISOString(),
        });
      }

      // Update cache
      cachedMarkets = out;
      cachedAt = Date.now();
      return out;
    });
  } catch (lastErr) {
    logger.warn({ err: lastErr instanceof Error ? lastErr.message : lastErr }, "[fetchMarketsOnChain] all RPCs failed");
    return [];
  }
}

