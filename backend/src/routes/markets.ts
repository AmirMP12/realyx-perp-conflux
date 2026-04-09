import { Router, Request, Response } from "express";
import { fetchMarkets, fetchProtocol } from "../services/indexer.js";
import { getActiveMarketAddresses } from "../services/activeMarkets.js";
import { fetchCoinGeckoPrices, getCoinGeckoIdForMarket, fetchPriceHistory } from "../services/coingecko.js";
import { fetchPythPrices, fetchPyth24hChange, getPythTvSymbol, fetchPythPriceHistory, fetchPythPriceHistoryHermes, getPythFeedId } from "../services/pyth.js";
import type { BackendMarket, ApiResponse } from "../types/index.js";
import { toDecimal, PRECISION_1E18 } from "../utils/format.js";

const router = Router();

const MARKET_META: Record<string, { name: string; symbol: string; image: string }> = {
  "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": {
    name: "Conflux",
    symbol: "CFX-USD",
    image: "https://coin-images.coingecko.com/coins/images/13043/large/conflux-logo.png",
  },
  "0x986a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Bitcoin",
    symbol: "BTC-USD",
    image: "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png",
  },
  "0x886a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Ethereum",
    symbol: "ETH-USD",
    image: "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png",
  },
  "0x286a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Tether Gold",
    symbol: "XAUT-USD",
    image: "https://coin-images.coingecko.com/coins/images/10481/small/Tether_Gold.png",
  },
  "0x786a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "NVIDIA",
    symbol: "NVDAX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55633/large/Ticker_NVDA__Company_Name_NVIDIA_Corp__size_200x200_2x.png",
  },
  "0x686a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Tesla",
    symbol: "TSLAX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55638/large/Ticker_TSLA__Company_Name_Tesla_Inc.__size_200x200_2x.png",
  },
  "0x586a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Meta",
    symbol: "METAX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55628/large/Ticker_META__Company_Name_Meta_Platforms_Inc.__size_200x200_2x.png",
  },
  "0x486a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Circle",
    symbol: "CRCLX-USD",
    image: "https://coin-images.coingecko.com/coins/images/66918/large/CRCLx.png",
  },
  "0x386a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Alphabet",
    symbol: "GOOGLX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55610/large/Ticker_GOOG__Company_Name_Alphabet_Inc.__size_200x200_2x.png",
  },
  "0x946a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Netflix",
    symbol: "NFLXX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55632/large/Ticker_NFLX__Company_Name_Netflix_Inc.__size_200x200_2x.png",
  },
  "0x956a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Apple",
    symbol: "AAPLX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55586/large/Ticker_AAPL__Company_Name_Apple_Inc.__size_200x200_2x.png",
  },
  "0x966a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Coinbase",
    symbol: "COINX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55602/large/Ticker_COIN__Company_Name_Coinbase__size_200x200_2x.png",
  },
  "0x976a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "McDonald's",
    symbol: "MCDX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55625/large/Ticker_MCD__Company_Name_McDonalds__size_200x200_2x.png",
  },
  "0x006a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "Robinhood",
    symbol: "HOODX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55613/large/Ticker_HOOD__Company_Name_Robinhood__size_200x200_2x.png",
  },
  "0x116a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "MicroStrategy",
    symbol: "MSTRX-USD",
    image: "https://coin-images.coingecko.com/coins/images/55631/large/Ticker_MSTR__Company_Name_MicroStrategy__size_200x200_2x.png",
  },
  "0x706a383f6de4a24dd3f524f0f93546229b58265f": {
    name: "S&P 500",
    symbol: "SPYX-USD",
    image: "https://coin-images.coingecko.com/coins/images/68655/large/spyon_160x160.png",
  },
};


export type MarketCategory = "CRYPTO" | "STOCK" | "COMMODITY" | "FOREX";
const MARKET_CATEGORY: Record<string, MarketCategory> = {
  "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": "CRYPTO",
  "0x986a383f6de4a24dd3f524f0f93546229b58265f": "CRYPTO",
  "0x886a383f6de4a24dd3f524f0f93546229b58265f": "CRYPTO",
  "0x286a383f6de4a24dd3f524f0f93546229b58265f": "COMMODITY",
  "0x786a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x686a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x586a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x486a383f6de4a24dd3f524f0f93546229b58265f": "CRYPTO",
  "0x386a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x946a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x956a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x966a383f6de4a24dd3f524f0f93546229b58265f": "CRYPTO",
  "0x976a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x006a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x116a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
  "0x706a383f6de4a24dd3f524f0f93546229b58265f": "STOCK",
};


function getMarketCategory(marketAddress: string): MarketCategory {
  return MARKET_CATEGORY[marketAddress.toLowerCase()] ?? "CRYPTO";
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

router.get("/", async (_req: Request, res: Response) => {
  try {
    let markets = await fetchMarkets();
    if (markets.length === 0) {
      const fallback = buildFallbackMarkets();
      try {
        const [protocol, cgPrices, pythPrices] = await Promise.all([fetchProtocol(), fetchCoinGeckoPrices(), fetchPythPrices()]);
        const protocolVolume24h = protocol?.totalVolumeUsd ? toDecimal(protocol.totalVolumeUsd) : "0";
        const pythChanges = await Promise.all(
          fallback.map((m) => fetchPyth24hChange(m.marketAddress).catch(() => undefined))
        );
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
          return { ...m, indexPrice, lastPrice: indexPrice, volume24h: protocolVolume24h, ...(change24h !== undefined && { change24h }) };
        });
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
    const [protocol, cgPrices, pythPrices] = await Promise.all([
      fetchProtocol().catch(() => null),
      fetchCoinGeckoPrices().catch(() => ({})),
      fetchPythPrices().catch(() => ({}))
    ]);
    const protocolVolume24h = protocol?.totalVolumeUsd ? toDecimal(protocol.totalVolumeUsd) : "0";
    const pythChanges = await Promise.all(
      markets.map((m) => {
        const a = (typeof m.marketAddress === "string" ? m.marketAddress : String(m.marketAddress)).toLowerCase();
        return fetchPyth24hChange(a).catch(() => undefined);
      })
    );
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
        volume24h: protocolVolume24h,
        longOI: toDecimal(m.totalLongSize),
        shortOI: toDecimal(m.totalShortSize),
        fundingRate: (Number(m.fundingRate) / PRECISION_1E18).toFixed(6),
        maxLeverage: Number(m.maxLeverage) || 30,
        isPaused: !m.isActive,
        ...(change24h !== undefined && { change24h }),
      };
    });
    res.json({ success: true, data } as ApiResponse<BackendMarket[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch markets";
    try {
      const fallback = buildFallbackMarkets();
      const [protocol, cgPrices, pythPrices] = await Promise.all([
        fetchProtocol().catch(() => null),
        fetchCoinGeckoPrices().catch(() => ({})),
        fetchPythPrices().catch(() => ({}))
      ]);
      const protocolVolume24h = protocol?.totalVolumeUsd ? toDecimal(protocol.totalVolumeUsd) : "0";
      const pythChanges = await Promise.all(
        fallback.map((m) => fetchPyth24hChange(m.marketAddress).catch(() => undefined))
      );
      const cg = cgPrices as Record<string, { price: number; change24h?: number }>;
      const pyth = pythPrices as Record<string, number>;
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
        return { ...m, indexPrice, lastPrice: indexPrice, volume24h: protocolVolume24h, ...(change24h !== undefined && { change24h }) };
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
