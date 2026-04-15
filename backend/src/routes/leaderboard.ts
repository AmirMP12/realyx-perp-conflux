import { Router, Request, Response } from "express";
import { fetchLeaderboard, type LeaderboardTimeframe } from "../services/indexer.js";
import type { LeaderboardEntry, ApiResponse } from "../types/index.js";
import { toDecimal18 } from "../utils/format.js";

const router = Router();

function parseTimeframe(q: unknown): LeaderboardTimeframe {
  const s = String(q ?? "all").toLowerCase().replace(/\s+/g, "");
  if (s === "24h") return "24h";
  if (s === "7d") return "7d";
  if (s === "alltime" || s === "all") return "all";
  return "all";
}

router.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 100);
  const timeframe = parseTimeframe(req.query.timeframe);
  try {
    const users = await fetchLeaderboard(limit, timeframe);
    const data: LeaderboardEntry[] = users.map((u, i) => ({
      rank: i + 1,
      wallet: u.address,
      pnl: toDecimal18(u.totalRealizedPnl),
      volume: Number(u.totalVolumeUsd).toFixed(6),
      trades: Number(u.totalTrades) || 0,
    }));
    res.json({ success: true, data } as ApiResponse<LeaderboardEntry[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch leaderboard";
    res.json({ success: false, error: message, data: [] } as ApiResponse<LeaderboardEntry[]>);
  }
});

export default router;
