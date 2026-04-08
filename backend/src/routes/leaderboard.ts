import { Router, Request, Response } from "express";
import { fetchLeaderboard } from "../services/indexer.js";
import type { LeaderboardEntry, ApiResponse } from "../types/index.js";
import { toDecimal } from "../utils/format.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 100);
  try {
    const users = await fetchLeaderboard(limit);
    const data: LeaderboardEntry[] = users.map((u, i) => ({
      rank: i + 1,
      wallet: u.address,
      pnl: toDecimal(u.totalRealizedPnl),
      volume: toDecimal(u.totalVolumeUsd),
      trades: Number(u.totalTrades) || 0,
    }));
    res.json({ success: true, data } as ApiResponse<LeaderboardEntry[]>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch leaderboard";
    res.json({ success: false, error: message, data: [] } as ApiResponse<LeaderboardEntry[]>);
  }
});

export default router;
