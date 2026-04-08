import { Router, Request, Response } from "express";
import { fetchUserPositions, fetchUserTrades } from "../services/indexer.js";
import type { BackendPosition, TradeHistoryItem, ApiResponse } from "../types/index.js";
import { toDecimal } from "../utils/format.js";

const router = Router();

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
      market: t.market.id,
      side: t.isLong ? "LONG" : "SHORT",
      size: toDecimal(t.size),
      price: toDecimal(t.price),
      leverage: 0,
      fee: toDecimal(t.fee),
      pnl: t.realizedPnl ? toDecimal(t.realizedPnl) : null,
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
