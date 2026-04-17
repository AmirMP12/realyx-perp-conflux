import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TESTNET_RPCS = ["https://evmtestnet.confluxrpc.com", "https://evmtestnet.confluxrpc.org"];
const DEFAULT_MAINNET_RPCS = ["https://evm.confluxrpc.com"];

function getRpcUrls(): string[] {
  const primary = (process.env.RPC_URL ?? "").trim();
  const fallbackEnv = (process.env.RPC_FALLBACK_URL ?? "").trim();
  const urls: string[] = primary ? [primary] : [];
  if (fallbackEnv && !urls.includes(fallbackEnv)) urls.push(fallbackEnv);
  const chainId = process.env.CHAIN_ID ?? "71";
  const defaults = chainId === "1030" ? DEFAULT_MAINNET_RPCS : DEFAULT_TESTNET_RPCS;
  for (const u of defaults) if (!urls.includes(u)) urls.push(u);
  return urls;
}

function loadTradingCoreAbi(): ethers.InterfaceAbi {
  const abiPath = join(__dirname, "../abi/TradingCore.json");
  return JSON.parse(readFileSync(abiPath, "utf8")) as ethers.InterfaceAbi;
}

function toStr(n: unknown): string {
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

function calculateInstantFundingRate(longOI: bigint, shortOI: bigint): bigint {
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
 * Fixes API consumers seeing volume24h / OI / funding all zero on Vercel or without DB.
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

async function _fetchMarketsOnChainImpl(): Promise<OnchainMarketRow[]> {
  const tradingCoreAddress = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
  if (!tradingCoreAddress) return [];

  const chainId = parseInt(process.env.CHAIN_ID ?? "71", 10);
  const urls = getRpcUrls();
  if (urls.length === 0) return [];

  let lastErr: unknown;
  for (const rpcUrl of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
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
        const longOI = BigInt(info.totalLongSize || 0);
        const shortOI = BigInt(info.totalShortSize || 0);
        const liveFundingRate = calculateInstantFundingRate(longOI, shortOI);
        const normalizedFundingRate = (Number(liveFundingRate) / 1e18).toString();

        out.push({
          id: addr.toLowerCase(),
          marketAddress: addr,
          maxLeverage: toStr(info.maxLeverage),
          maxPositionSize: toStr(info.maxPositionSize),
          maxTotalExposure: toStr(info.maxTotalExposure),
          totalLongSize: toStr(info.totalLongSize),
          totalShortSize: toStr(info.totalShortSize),
          totalLongCost: toStr(info.totalLongCost),
          totalShortCost: toStr(info.totalShortCost),
          fundingRate: normalizedFundingRate, // Normalized decimal string
          cumulativeFunding: fund ? toStr(fund.cumulativeFunding) : "0",
          lastFundingTime: fund ? toStr(fund.lastSettlement) : "0",
          longOpenInterest: toStr(longOI),
          shortOpenInterest: toStr(shortOI),
          isActive: Boolean(info.isActive),
          isListed: Boolean(info.isListed),
          updatedAt: new Date().toISOString(),
        });
      }

      // Update cache
      cachedMarkets = out;
      cachedAt = Date.now();
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn("[fetchMarketsOnChain] all RPCs failed:", lastErr instanceof Error ? lastErr.message : lastErr);
  return [];
}

