import { Router, Request, Response } from "express";
import { fetchMarkets, fetchProtocol } from "../services/indexer.js";
import { getActiveMarketAddresses } from "../services/activeMarkets.js";
import { fetchCoinGeckoPrices, getCoinGeckoIdForMarket, fetchPriceHistory } from "../services/coingecko.js";
import { fetchPythPrices, fetchPyth24hChange, getPythTvSymbol, fetchPythPriceHistory, fetchPythPriceHistoryHermes, getPythFeedId } from "../services/pyth.js";
import type { BackendMarket, ApiResponse } from "../types/index.js";
import { toDecimal18, PRECISION_1E18 } from "../utils/format.js";
import { checkAndSync } from "./sync.js";

const router = Router();
const ENABLE_PYTH_24H = process.env.ENABLE_PYTH_24H != null
  ? /^(1|true|yes)$/i.test(process.env.ENABLE_PYTH_24H)
  : !process.env.VERCEL;

import { MARKET_META, type MarketCategory } from "../constants/markets.js";

function getMarketCategory(marketAddress: string): MarketCategory {
  return MARKET_META[marketAddress.toLowerCase()]?.category ?? "CRYPTO";
}

function getMarketMeta(marketAddress: string): { name: string; symbol: string; image: string } {
  const key = marketAddress.toLowerCase();
  const meta = MARKET_META[key];
  if (meta) return meta;
  const short = marketAddress.slice(0, 10) + "…";
  return { name: short, symbol: short, image: "" };
}

function buildFallbackMarkets(): BackendMarket[] {
  return Object.entries(MARKET_META).map(([addr, meta]) => ({
    id: addr.toLowerCase(),
    name: meta.name,
    symbol: meta.symbol,
    image: meta.image,
    marketAddress: addr,
    category: getMarketCategory(addr),
    indexPrice: "0",
    lastPrice: "0",
    volume24h: "0",
    longOI: "0",
    shortOI: "0",
    fundingRate: "0",
    maxLeverage: 30,
    isPaused: false,
  }));
}

// ── Response-level cache for /markets ──
let marketsResponseCache: { data: BackendMarket[]; fallback?: boolean } | null = null;
let marketsResponseCachedAt = 0;
const MARKETS_RESPONSE_TTL_MS = 5_000;

export function clearMarketsCache() {
  marketsResponseCache = null;
  marketsResponseCachedAt = 0;
}


router.get("/", async (_req: Request, res: Response) => {
  // Ensure sync is fresh in serverless env
  await checkAndSync();

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Serve from cache if fresh
  if (marketsResponseCache && Date.now() - marketsResponseCachedAt < MARKETS_RESPONSE_TTL_MS) {
    return res.json({
      success: true,
      data: marketsResponseCache.data,
      ...(marketsResponseCache.fallback && { fallback: true }),
    } as ApiResponse<BackendMarket[]>);
  }

  try {
    let markets = await fetchMarkets();
    if (markets.length === 0) {
      const fallback = buildFallbackMarkets();
      try {
        const [_protocol, cgPrices, pythPrices] = await Promise.all([fetchProtocol(), fetchCoinGeckoPrices(), fetchPythPrices()]);
        const pythChanges = ENABLE_PYTH_24H
          ? await Promise.all(
              fallback.map((m) => fetchPyth24hChange(m.marketAddress).catch(() => undefined))
            )
          : fallback.map(() => undefined);
        const enriched = fallback.map((m, i) => {
          const addr = m.marketAddress.toLowerCase();
          const cgId = getCoinGeckoIdForMarket(m.marketAddress);
          let indexPrice = "0";
          let change24h: number | undefined = pythChanges[i];
          if (cgId && cgPrices[cgId]) {
            indexPrice = String(cgPrices[cgId].price);
            if (change24h === undefined) change24h = cgPrices[cgId].change24h;
          }
          const pythPrice = pythPrices[addr];
          if (pythPrice != null && pythPrice > 0) indexPrice = String(pythPrice);
          return { ...m, indexPrice, lastPrice: indexPrice, volume24h: "0", ...(change24h !== undefined && { change24h }) };
        });
        marketsResponseCache = { data: enriched, fallback: true };
        marketsResponseCachedAt = Date.now();
        return res.json({ success: true, data: enriched, fallback: true } as ApiResponse<BackendMarket[]>);
      } catch {
        return res.json({ success: true, data: fallback, fallback: true } as ApiResponse<BackendMarket[]>);
      }
    }
    const activeSet = await getActiveMarketAddresses();
    if (activeSet && activeSet.size > 0) {
      markets = markets.filter((m) => {
        const addr = typeof m.marketAddress === "string" ? m.marketAddress : String(m.marketAddress);
        return activeSet.has(addr.toLowerCase());
      });
    }
    const [_protocol, cgPricesRaw, pythPricesRaw] = await Promise.all([
      fetchProtocol().catch(() => null),
      fetchCoinGeckoPrices().catch(() => ({})),
      fetchPythPrices().catch(() => ({}))
    ]);
    const cgPrices = cgPricesRaw as Record<string, any>;
    const pythPrices = pythPricesRaw as Record<string, any>;
    const pythChanges = ENABLE_PYTH_24H
      ? await Promise.all(
          markets.map((m) => {
            const a = (typeof m.marketAddress === "string" ? m.marketAddress : String(m.marketAddress)).toLowerCase();
            return fetchPyth24hChange(a).catch(() => undefined);
          })
        )
      : markets.map(() => undefined);
    const data: BackendMarket[] = markets.map((m, i) => {
      const addr = (typeof m.marketAddress === "string" ? m.marketAddress : String(m.marketAddress)).toLowerCase();
      const longSize = Number(m.totalLongSize);
      const shortSize = Number(m.totalShortSize);
      let indexPrice =
        longSize > 0 ? (Number(m.totalLongCost) / longSize / 1e12).toFixed(6) : "0";
      const lastPrice =
        shortSize > 0 ? (Number(m.totalShortCost) / shortSize / 1e12).toFixed(6) : "0";
      const meta = getMarketMeta(m.marketAddress);
      const cgId = getCoinGeckoIdForMarket(m.marketAddress);
      let change24h: number | undefined = pythChanges[i];
      const preferCoinGeckoForPrice = new Set(["0x926a383f6de4a24dd3f524f0f93546229b58265f"]); // SNX-USD: always use CoinGecko
      if (cgId && cgPrices[cgId] && change24h === undefined) {
        change24h = cgPrices[cgId].change24h;
      }
      if (cgId && cgPrices[cgId]) {
        if (Number(indexPrice) === 0 || preferCoinGeckoForPrice.has(addr)) {
          indexPrice = String(cgPrices[cgId].price);
        }
      }
      const pythPrice = pythPrices[addr];
      if (pythPrice != null && pythPrice > 0 && !preferCoinGeckoForPrice.has(addr)) indexPrice = String(pythPrice);
      return {
        id: m.id,
        name: meta.name,
        symbol: meta.symbol,
        image: meta.image,
        marketAddress: m.marketAddress,
        category: getMarketCategory(addr),
        indexPrice,
        lastPrice,
        volume24h: m.volume24h || "0",
        longOI: toDecimal18(m.totalLongSize),
        shortOI: toDecimal18(m.totalShortSize),
        fundingRate: (Number(m.fundingRate) / PRECISION_1E18).toFixed(6),
        maxLeverage: Number(m.maxLeverage) || 30,
        isPaused: !m.isActive,
        ...(change24h !== undefined && { change24h }),
      };
    });
    marketsResponseCache = { data };
    marketsResponseCachedAt = Date.now();
    res.json({ success: true, data } as ApiResponse<BackendMarket[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch markets";
    try {
      const fallback = buildFallbackMarkets();
      const [_protocol, cgPrRaw, pythPrRaw] = await Promise.all([
        fetchProtocol().catch(() => null),
        fetchCoinGeckoPrices().catch(() => ({})),
        fetchPythPrices().catch(() => ({}))
      ]);
      const pythChanges = ENABLE_PYTH_24H
        ? await Promise.all(
            fallback.map((m) => fetchPyth24hChange(m.marketAddress).catch(() => undefined))
          )
        : fallback.map(() => undefined);
      const cg = cgPrRaw as Record<string, any>;
      const pyth = pythPrRaw as Record<string, any>;
      const enriched = fallback.map((m, i) => {
        const addr = m.marketAddress.toLowerCase();
        const cgId = getCoinGeckoIdForMarket(m.marketAddress);
        let indexPrice = "0";
        let change24h: number | undefined = pythChanges[i];
        if (cgId && cg[cgId]) {
          indexPrice = String(cg[cgId].price);
          if (change24h === undefined) change24h = cg[cgId].change24h;
        }
        if (pyth[addr] != null && pyth[addr] > 0) indexPrice = String(pyth[addr]);
        return { ...m, indexPrice, lastPrice: indexPrice, volume24h: "0", ...(change24h !== undefined && { change24h }) };
      });
      return res.json({ success: true, data: enriched, fallback: true } as ApiResponse<BackendMarket[]>);
    } catch {
      return res.json({ success: false, error: message, data: buildFallbackMarkets() } as ApiResponse<BackendMarket[]>);
    }
  }
});

router.get("/price-history/:marketId", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.marketId ?? "";
    const marketId = rawId.toLowerCase();
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const source = (req.query.source as string)?.toLowerCase();

    const pythSymbol = getPythTvSymbol(marketId);
    if (pythSymbol) {
      const prices = await fetchPythPriceHistory(marketId, days);
      if (prices.length > 0 || source === "pyth") {
        return res.json({ success: true, data: prices });
      }
      const feedId = getPythFeedId(marketId);
      if (feedId) {
        const hermPrices = await fetchPythPriceHistoryHermes(marketId, days, 24);
        if (hermPrices.length > 0) {
          return res.json({ success: true, data: hermPrices });
        }
      }
    }

    const cgId = getCoinGeckoIdForMarket(marketId);
    if (!cgId) {
      return res.status(404).json({ success: false, error: "Market not found", data: [] });
    }
    const prices = await fetchPriceHistory(cgId, days);
    res.json({ success: true, data: prices });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch price history";
    // Return 200 or 404 instead of 500 to keep the UI from breaking entirely
    res.json({ success: false, error: message, data: [] });
  }
});

export default router;
