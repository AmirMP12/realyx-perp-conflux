import { Router, Request, Response } from "express";
import { getPool, fetchUserPositions } from "../services/indexer.js";
import { getCopyEngine } from "../services/copyEngine.js";

const router = Router();

/**
 * Postgres error codes that all mean "the copy-trading schema isn't (fully)
 * provisioned on this deployment". The schema (lead_traders, lead_trader_stats,
 * copy_relationships, …) is not created by the indexer's `initDB` and has no
 * migration yet, so depending on how far a deployment got, a query can fail in
 * several distinct ways:
 *   - 42P01 undefined_table     → table doesn't exist at all
 *   - 42703 undefined_column    → table exists but a referenced column is missing
 *   - 42883 undefined_function  → a referenced function/operator is missing
 *   - 3F000 invalid_schema_name → the schema/namespace doesn't exist
 *   - 42P02 / 42704 undefined_object → other missing object references
 * Any of these should surface as a clean "feature not provisioned" signal so
 * the UI shows an honest "Coming Soon / no lead traders" state instead of an
 * opaque 500 that the frontend renders as "Request failed".
 */
const PG_SCHEMA_NOT_PROVISIONED = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "3F000", // invalid_schema_name
  "42P02", // undefined_parameter
  "42704", // undefined_object
]);

function isMissingSchema(err: unknown): boolean {
  const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
  return typeof code === "string" && PG_SCHEMA_NOT_PROVISIONED.has(code);
}

/**
 * Deterministic check that the copy-trading schema exists. `to_regclass`
 * returns NULL (instead of throwing) when a table is absent, so we can decide
 * up front whether to serve the graceful "feature not provisioned" response
 * rather than relying on catching the right error code mid-query. The lead
 * traders table is the linchpin every social read joins against.
 */
async function isCopySchemaReady(pool: import("pg").Pool): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT to_regclass('public.lead_traders') AS lead,
              to_regclass('public.lead_trader_stats') AS stats`
    );
    return Boolean(rows[0]?.lead && rows[0]?.stats);
  } catch {
    return false;
  }
}

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

    if (!(await isCopySchemaReady(pool))) {
      return res.status(501).json({ error: "Copy trading is not enabled on this deployment" });
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

    // Open positions come from the indexed position_events store (the same
    // source the rest of the app uses); there is no separate `positions` table.
    // Unrealized PnL needs a live oracle mark we don't compute offline, so it's
    // reported as "0" here rather than fabricated.
    const openPositions: OpenPosition[] = (await fetchUserPositions(normalizedAddr)).map((p) => ({
      market: p.market.marketAddress,
      isLong: p.isLong,
      size: p.size,
      leverage: p.leverage,
      entryPrice: p.entryPrice,
      pnl: "0",
    }));

    const profile: TraderProfile = {
      address: trader.address,
      profitFeeBps: trader.profit_fee_bps,
      metadataURI: trader.metadata_uri,
      activeFollowers: trader.active_followers,
      totalPnl: trader.total_pnl,
      roi: Number(trader.roi),
      winRate: Number(trader.win_rate),
      totalTrades: Number(trader.total_trades),
      openPositions,
    };

    return res.json(profile);
  } catch (err: any) {
    if (isMissingSchema(err)) {
      return res.status(501).json({ error: "Copy trading is not enabled on this deployment" });
    }
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

      if (!(await isCopySchemaReady(pool))) {
        return res.status(501).json({ error: "Copy trading is not enabled on this deployment" });
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
      if (isMissingSchema(err)) {
        return res.status(501).json({ error: "Copy trading is not enabled on this deployment" });
      }
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

      if (!(await isCopySchemaReady(pool))) {
        return res.status(501).json({ error: "Copy trading is not enabled on this deployment" });
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
      if (isMissingSchema(err)) {
        return res.status(501).json({ error: "Copy trading is not enabled on this deployment" });
      }
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

    // No copy-trading schema → no lead traders yet. Return an empty set so the
    // UI renders an honest "no lead traders" state instead of an error.
    if (!(await isCopySchemaReady(pool))) {
      return res.json({ traders: [] });
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
    if (isMissingSchema(err)) {
      // No copy-trading schema → no lead traders yet. Return an empty set so
      // the UI renders an honest "no lead traders" state instead of an error.
      return res.json({ traders: [] });
    }
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