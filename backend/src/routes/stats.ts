import { Router, Request, Response } from "express";
import { fetchProtocol, fetchMarkets, fetchProtocolMetrics } from "../services/indexer.js";
import { getActiveMarketAddresses } from "../services/activeMarkets.js";
import type { ProtocolStats, DailyStat, ApiResponse } from "../types/index.js";
import { toDecimal } from "../utils/format.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [protocol, marketsResult] = await Promise.all([fetchProtocol(), fetchMarkets()]);
    let markets = marketsResult;
    const activeSet = await getActiveMarketAddresses();
    if (activeSet && activeSet.size > 0) {
      markets = markets.filter((m) => {
        const addr = typeof m.marketAddress === "string" ? m.marketAddress : String(m.marketAddress);
        return activeSet.has(addr.toLowerCase());
      });
    }
    const totalMarkets = markets.length;
    const volume24h = protocol?.totalVolumeUsd ? toDecimal(protocol.totalVolumeUsd) : "0";
    let totalOpenInterest = "0";
    if (markets.length > 0) {
      const oi = markets.reduce(
        (acc, m) => acc + Number(m.totalLongSize) + Number(m.totalShortSize),
        0
      );
      totalOpenInterest = (oi / 1e12).toFixed(6);
    }
    const totalLiquidations = protocol?.totalLiquidations ? toDecimal(protocol.totalLiquidations) : "0";
    res.json({
      success: true,
      data: { totalMarkets, volume24h, totalOpenInterest, totalLiquidations } as ProtocolStats & { totalLiquidations: string },
    } as ApiResponse<ProtocolStats & { totalLiquidations: string }>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch stats";
    res.json({
      success: false,
      error: message,
      data: { totalMarkets: 0, volume24h: "0", totalOpenInterest: "0", totalLiquidations: "0" },
    } as ApiResponse<ProtocolStats & { totalLiquidations: string }>);
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
        volume: toDecimal(m.volumeUsd),
        trades: Number(m.tradesCount) || 0,
        fees: toDecimal(m.feesUsd),
        pnl: "0", // ProtocolMetric does not expose daily pnl
      };
    });
    res.json({ success: true, data } as ApiResponse<DailyStat[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch stats history";
    res.json({ success: false, error: message, data: [] } as ApiResponse<DailyStat[]>);
  }
});

export default router;
