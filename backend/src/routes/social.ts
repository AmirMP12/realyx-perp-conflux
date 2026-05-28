import { Router, Request, Response } from "express";
import { getPool } from "../services/indexer.js";
import { getCopyEngine } from "../services/copyEngine.js";

const router = Router();

// ─── Types ──────────────────────────────────────────────────────────

interface TraderProfile {
  address: string;
  profitFeeBps: number;
  metadataURI: string;
  activeFollowers: number;
  totalPnl: string;
  roi: number;
  winRate: number;
  totalTrades: number;
  openPositions: OpenPosition[];
}

interface OpenPosition {
  market: string;
  isLong: boolean;
  size: string;
  leverage: string;
  entryPrice: string;
  pnl: string;
}

interface CopierInfo {
  address: string;
  maxAllocation: string;
  maxLeverage: number;
  startedAt: string;
  copiedPnl: string;
}

// ─── GET /api/social/trader/:address ────────────────────────────────

router.get("/trader/:address", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    const { address } = req.params;
    const normalizedAddr = address.toLowerCase();

    // Get lead trader info
    const { rows: traderRows } = await pool.query(
      `SELECT lt.id, lt.address, lt.profit_fee_bps, lt.metadata_uri, lt.active_followers,
              COALESCE(ls.total_pnl, '0') as total_pnl,
              COALESCE(ls.roi, 0) as roi,
              COALESCE(ls.win_rate, 0) as win_rate,
              COALESCE(ls.total_trades, 0) as total_trades
       FROM lead_traders lt
       LEFT JOIN lead_trader_stats ls ON ls.lead_trader_id = lt.id
       WHERE lt.address = $1 AND lt.is_active = true`,
      [normalizedAddr]
    );

    if (traderRows.length === 0) {
      return res.status(404).json({ error: "Lead trader not found" });
    }

    const trader = traderRows[0];

    // Get open positions for this trader
    const { rows: positionRows } = await pool.query(
      `SELECT p.market, p.is_long, p.size, p.leverage, p.entry_price,
              COALESCE(p.unrealized_pnl, '0') as pnl
       FROM positions p
       WHERE p.trader_address = $1 AND p.state = 'open'
       ORDER BY p.open_timestamp DESC`,
      [normalizedAddr]
    );

    const profile: TraderProfile = {
      address: trader.address,
      profitFeeBps: trader.profit_fee_bps,
      metadataURI: trader.metadata_uri,
      activeFollowers: trader.active_followers,
      totalPnl: trader.total_pnl,
      roi: Number(trader.roi),
      winRate: Number(trader.win_rate),
      totalTrades: Number(trader.total_trades),
      openPositions: positionRows.map((p: any) => ({
        market: p.market,
        isLong: p.is_long,
        size: p.size,
        leverage: p.leverage,
        entryPrice: p.entry_price,
        pnl: p.pnl,
      })),
    };

    return res.json(profile);
  } catch (err: any) {
    console.error("[social] Error fetching trader profile:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/social/copier/:address/following ──────────────────────

router.get(
  "/copier/:address/following",
  async (req: Request, res: Response) => {
    try {
      const pool = getPool();
      if (!pool) {
        return res.status(503).json({ error: "Database unavailable" });
      }

      const { address } = req.params;
      const normalizedAddr = address.toLowerCase();

      const { rows } = await pool.query(
        `SELECT cr.lead_trader_address, cr.max_allocation, cr.max_leverage,
                cr.started_at,
                COALESCE(cs.total_pnl, '0') as copied_pnl
         FROM copy_relationships cr
         LEFT JOIN copier_stats cs ON cs.copier_address = cr.copier_address
           AND cs.lead_trader_address = cr.lead_trader_address
         WHERE cr.copier_address = $1 AND cr.is_active = true
         ORDER BY cr.started_at DESC`,
        [normalizedAddr]
      );

      const following: CopierInfo[] = rows.map((r: any) => ({
        address: r.lead_trader_address,
        maxAllocation: r.max_allocation,
        maxLeverage: r.max_leverage,
        startedAt: r.started_at,
        copiedPnl: r.copied_pnl,
      }));

      return res.json({ following });
    } catch (err: any) {
      console.error("[social] Error fetching following list:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── GET /api/social/copier/:address/pnl ────────────────────────────

router.get(
  "/copier/:address/pnl",
  async (req: Request, res: Response) => {
    try {
      const pool = getPool();
      if (!pool) {
        return res.status(503).json({ error: "Database unavailable" });
      }

      const { address } = req.params;
      const normalizedAddr = address.toLowerCase();

      // Aggregate PnL per lead trader from copied positions
      const { rows } = await pool.query(
        `SELECT cr.lead_trader_address,
                SUM(COALESCE(pos.realized_pnl, 0) + COALESCE(pos.unrealized_pnl, 0)) as total_pnl
         FROM copy_relationships cr
         LEFT JOIN copied_positions pos ON pos.copier_address = cr.copier_address
           AND pos.lead_trader_address = cr.lead_trader_address
         WHERE cr.copier_address = $1 AND cr.is_active = true
         GROUP BY cr.lead_trader_address`,
        [normalizedAddr]
      );

      const pnlByTrader: Record<string, string> = {};
      let totalCopiedPnl = "0";
      for (const row of rows) {
        pnlByTrader[row.lead_trader_address] = row.total_pnl || "0";
      }

      // Sum all
      const total = rows.reduce(
        (sum: bigint, r: any) => sum + BigInt(r.total_pnl || "0"),
        0n
      );
      totalCopiedPnl = total.toString();

      return res.json({
        totalCopiedPnl,
        pnlByTrader,
        copierAddress: normalizedAddr,
      });
    } catch (err: any) {
      console.error("[social] Error fetching copier PnL:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── GET /api/social/top-traders ────────────────────────────────────

router.get("/top-traders", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    const { rows } = await pool.query(
      `SELECT lt.address, lt.profit_fee_bps, lt.metadata_uri,
              lt.active_followers,
              COALESCE(ls.total_pnl, '0') as total_pnl,
              COALESCE(ls.roi, 0) as roi,
              COALESCE(ls.win_rate, 0) as win_rate,
              COALESCE(ls.total_trades, 0) as total_trades
       FROM lead_traders lt
       LEFT JOIN lead_trader_stats ls ON ls.lead_trader_id = lt.id
       WHERE lt.is_active = true
       ORDER BY ls.roi DESC NULLS LAST
       LIMIT 50`
    );

    const traders = rows.map((r: any) => ({
      address: r.address,
      profitFeeBps: r.profit_fee_bps,
      metadataURI: r.metadata_uri,
      activeFollowers: r.active_followers,
      totalPnl: r.total_pnl,
      roi: Number(r.roi),
      winRate: Number(r.win_rate),
      totalTrades: Number(r.total_trades),
    }));

    return res.json({ traders });
  } catch (err: any) {
    console.error("[social] Error fetching top traders:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/social/refresh ──────────────────────────────────────

router.post("/refresh", async (_req: Request, res: Response) => {
  try {
    const engine = getCopyEngine();
    if (engine) {
      await engine.refreshLeadTraders();
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[social] Error refreshing copy engine:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;