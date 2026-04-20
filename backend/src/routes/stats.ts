import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import {
  fetchProtocol,
  fetchMarkets,
  fetchProtocolMetrics,
  fetchActiveTraders24h,
} from "../services/indexer.js";
import { getActiveMarketAddresses } from "../services/activeMarkets.js";
import type { ProtocolStats, DailyStat, ApiResponse } from "../types/index.js";
import { toDecimal18 } from "../utils/format.js";
import { checkAndSync } from "./sync.js";

const router = Router();

// ── Server-side TVL from VaultCore.totalAssets() ──
let cachedTvl: string = "0";
let tvlCachedAt = 0;
const TVL_CACHE_MS = 30_000; // 30s

async function fetchTvlFromChain(): Promise<string> {
  if (Date.now() - tvlCachedAt < TVL_CACHE_MS && cachedTvl !== "0") {
    return cachedTvl;
  }
  const vaultAddress = (process.env.VAULT_CORE_ADDRESS ?? process.env.DEPLOYED_VAULT_CORE ?? "").trim();
  const rpcUrl = (process.env.RPC_URL ?? "https://evmtestnet.confluxrpc.com").trim();
  if (!vaultAddress) return cachedTvl;
  try {
    const chainId = parseInt(process.env.CHAIN_ID ?? "71", 10);
    const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
    const contract = new ethers.Contract(vaultAddress, [
      "function totalAssets() view returns (uint256)",
    ], provider);
    const totalAssets = await contract.totalAssets();
    // totalAssets returns USDC * 1e12, i.e. 18 decimals
    const tvl = (Number(totalAssets) / 1e18).toFixed(6);
    cachedTvl = tvl;
    tvlCachedAt = Date.now();
    return tvl;
  } catch (e) {
    console.warn("[stats] TVL fetch failed:", e instanceof Error ? e.message : e);
    return cachedTvl;
  }
}

router.get("/", async (_req: Request, res: Response) => {
  // Trigger background sync if data is stale (lazy sync)
  await checkAndSync();

  try {
    const [protocol, marketsResult, activeTraders24h, tvl] = await Promise.all([
      fetchProtocol(),
      fetchMarkets(),
      fetchActiveTraders24h(),
      fetchTvlFromChain(),
    ]);
    let markets = marketsResult;
    const totalMarketsBeforeFilter = markets.length;
    const activeSet = await getActiveMarketAddresses();
    if (activeSet && activeSet.size > 0) {
      markets = markets.filter((m) => {
        const addr = typeof m.marketAddress === "string" ? m.marketAddress : String(m.marketAddress);
        return activeSet.has(addr.toLowerCase());
      });
    }
    // If filtering removed everything but we know there are markets, fall back to pre-filter count
    const totalMarkets = (markets.length === 0 && totalMarketsBeforeFilter > 0) 
      ? totalMarketsBeforeFilter 
      : markets.length;
    let volume24h = protocol?.totalVolumeUsd ? Number(protocol.totalVolumeUsd).toFixed(6) : "0";
    
    // Fallback: if global volume is 0 but we have markets with potential volume, sum them
    if (Number(volume24h) === 0 && markets.length > 0) {
        const sum = markets.reduce((acc, m) => acc + Number((m as any).volume24h || 0), 0);
        if (sum > 0) volume24h = sum.toFixed(6);
    }

    let totalOpenInterest = "0";
    if (markets.length > 0) {
      const oi = markets.reduce(
        (acc, m) => acc + Number(m.totalLongSize) + Number(m.totalShortSize),
        0
      );
      totalOpenInterest = (oi / 1e18).toFixed(6);
    }
    /** Event count from indexer — not a wei amount; do not pass through `toDecimal`. */
    const totalLiquidations = protocol?.totalLiquidations ?? "0";
    res.json({
      success: true,
      data: {
        totalMarkets,
        volume24h,
        totalOpenInterest,
        totalLiquidations,
        activeTraders24h,
        tvl,
      } as ProtocolStats & { totalLiquidations: string; tvl: string },
    } as ApiResponse<ProtocolStats & { totalLiquidations: string; tvl: string }>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch stats";
    res.json({
      success: false,
      error: message,
      data: {
        totalMarkets: 0,
        volume24h: "0",
        totalOpenInterest: "0",
        totalLiquidations: "0",
        activeTraders24h: 0,
        tvl: "0",
      },
    } as ApiResponse<ProtocolStats & { totalLiquidations: string; tvl: string }>);
  }
});

router.get("/history", async (_req: Request, res: Response) => {
  try {
    const metrics = await fetchProtocolMetrics(90, "day");
    const data: DailyStat[] = metrics.map((m) => {
      const ts = Number(m.timestamp) * 1000;
      const date = new Date(ts).toISOString().slice(0, 10);
      return {
        date,
        volume: toDecimal18(m.volumeUsd),
        trades: Number(m.tradesCount) || 0,
        fees: toDecimal18(m.feesUsd),
        pnl: "0.00", // ProtocolMetric does not expose daily pnl
      };
    });
    res.json({ success: true, data } as ApiResponse<DailyStat[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch stats history";
    res.json({ success: false, error: message, data: [] } as ApiResponse<DailyStat[]>);
  }
});

export default router;
