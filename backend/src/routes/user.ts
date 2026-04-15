import { Router, Request, Response } from "express";
import { fetchUserPositions, fetchUserTrades } from "../services/indexer.js";
import type { BackendPosition, TradeHistoryItem, ApiResponse } from "../types/index.js";
import { toDecimal, toDecimal18 } from "../utils/format.js";

const router = Router();

/** Map market contract address → display symbol (mirrors markets.ts MARKET_META) */
const MARKET_SYMBOL: Record<string, string> = {
  "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": "CFX-USD",
  "0x986a383f6de4a24dd3f524f0f93546229b58265f": "BTC-USD",
  "0x886a383f6de4a24dd3f524f0f93546229b58265f": "ETH-USD",
  "0x286a383f6de4a24dd3f524f0f93546229b58265f": "XAUT-USD",
  "0x786a383f6de4a24dd3f524f0f93546229b58265f": "NVDAX-USD",
  "0x686a383f6de4a24dd3f524f0f93546229b58265f": "TSLAX-USD",
  "0x586a383f6de4a24dd3f524f0f93546229b58265f": "METAX-USD",
  "0x486a383f6de4a24dd3f524f0f93546229b58265f": "CRCLX-USD",
  "0x386a383f6de4a24dd3f524f0f93546229b58265f": "GOOGLX-USD",
  "0x946a383f6de4a24dd3f524f0f93546229b58265f": "NFLXX-USD",
  "0x956a383f6de4a24dd3f524f0f93546229b58265f": "AAPLX-USD",
  "0x966a383f6de4a24dd3f524f0f93546229b58265f": "COINX-USD",
  "0x976a383f6de4a24dd3f524f0f93546229b58265f": "MCDX-USD",
  "0x006a383f6de4a24dd3f524f0f93546229b58265f": "HOODX-USD",
  "0x116a383f6de4a24dd3f524f0f93546229b58265f": "MSTRX-USD",
  "0x706a383f6de4a24dd3f524f0f93546229b58265f": "SPYX-USD",
};

function resolveMarketSymbol(marketId: string): string {
  if (!marketId) return "Unknown";
  const sym = MARKET_SYMBOL[marketId.toLowerCase()];
  if (sym) return sym;
  // If not in lookup, show a truncated address
  return marketId.length > 12 ? `${marketId.slice(0, 6)}…${marketId.slice(-4)}` : marketId;
}

router.get("/:address/positions", async (req: Request, res: Response) => {
  const address = (req.params.address ?? "").trim();
  if (!address) {
    return res.status(400).json({ success: false, error: "address required" } as ApiResponse<never>);
  }
  try {
    const positions = await fetchUserPositions(address);
    const data: BackendPosition[] = positions.map((p, i) => ({
      id: i + 1,
      market: {
        id: p.market.id,
        name: p.market.marketAddress.slice(0, 10) + "...",
        symbol: "NFT",
        collectionName: "",
        collectionImage: "",
      },
      side: p.isLong ? "LONG" : "SHORT",
      size: toDecimal(p.size),
      entryPrice: toDecimal(p.entryPrice),
      margin: toDecimal(p.collateralAmount),
      leverage: Number(p.leverage) || 1,
      unrealizedPnl: "0",
      realizedPnl: "0",
      liquidationPrice: toDecimal(p.liquidationPrice),
      breakEvenPrice: toDecimal(p.entryPrice),
      openTs: new Date(Number(p.openTimestamp) * 1000).toISOString(),
    }));
    res.json({ success: true, data } as ApiResponse<BackendPosition[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch positions";
    res.json({ success: false, error: message, data: [] } as ApiResponse<BackendPosition[]>);
  }
});

router.get("/:address/trades", async (req: Request, res: Response) => {
  const address = (req.params.address ?? "").trim();
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 200);
  if (!address) {
    return res.status(400).json({ success: false, error: "address required" } as ApiResponse<never>);
  }
  try {
    const trades = await fetchUserTrades(address, limit);
    const data: TradeHistoryItem[] = trades.map((t, i) => ({
      id: i + 1,
      signature: t.txHash,
      market: resolveMarketSymbol(t.market.id),
      side: t.isLong ? "LONG" : "SHORT",
      size: toDecimal18(t.size),
      price: toDecimal18(t.price),
      leverage: 0,
      fee: toDecimal18(t.fee),
      pnl: t.realizedPnl && t.realizedPnl !== "0" ? toDecimal18(t.realizedPnl) : null,
      type: t.type === "LIQUIDATE" ? "LIQUIDATED" : (t.type as "OPEN" | "CLOSE"),
      timestamp: new Date(Number(t.timestamp) * 1000).toISOString(),
    }));
    res.json({ success: true, data } as ApiResponse<TradeHistoryItem[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch trades";
    res.json({ success: false, error: message, data: [] } as ApiResponse<TradeHistoryItem[]>);
  }
});

export default router;

