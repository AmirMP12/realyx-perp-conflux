import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import pg from "pg";

const router = Router();
let poolInstance: pg.Pool | null = null;
function getPool(): pg.Pool | null {
  if (poolInstance) return poolInstance;
  if (!process.env.POSTGRES_URL) return null;
  poolInstance = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
  return poolInstance;
}

/**
 * The debug endpoint exposes internal DB/indexer state. In production it must
 * be protected by `DEBUG_SECRET` (sent as `Authorization: Bearer <secret>` or
 * `?key=<secret>`); if no secret is configured in production it is disabled.
 * Outside production it remains open for convenience.
 */
function requireDebugAuth(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }
  const secret = (process.env.DEBUG_SECRET ?? "").trim();
  if (!secret) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const provided =
    (req.headers.authorization === `Bearer ${secret}` ? secret : "") ||
    (typeof req.query.key === "string" ? req.query.key : "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.get("/", requireDebugAuth, async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) {
    return res.json({ error: "No DB connection string configured" });
  }

  const dbStatus: any = {
    connected: true,
    tradingCore: (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "NOT SET"),
    rpcUrl: process.env.RPC_URL ?? "Using default",
  };
  try {
    const rawRes = await pool.query("SELECT COUNT(*) FROM position_events");
    dbStatus.totalPositionEvents = rawRes.rows[0].count;

    const last24h = await pool.query("SELECT COUNT(*) FROM position_events WHERE (block_time IS NOT NULL AND block_time >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '24 hours'))::bigint) OR (block_time IS NULL AND created_at >= NOW() - INTERVAL '24 hours')");
    dbStatus.last24hEvents = last24h.rows[0].count;

    const missingBlockTime = await pool.query("SELECT COUNT(*) FROM position_events WHERE block_time IS NULL");
    dbStatus.eventsMissingBlockTime = missingBlockTime.rows[0].count;

    const state = await pool.query("SELECT last_synced_block, last_synced_at FROM indexer_state WHERE key = 'trading_core'");
    dbStatus.indexerState = state.rows[0] ? state.rows[0] : "None";

    // Referral rebate indexing observability.
    try {
      const rebateCount = await pool.query("SELECT COUNT(*) FROM referral_rebates");
      const rebateSum = await pool.query("SELECT COALESCE(SUM(amount), 0)::text AS total FROM referral_rebates");
      const latestRebate = await pool.query("SELECT referrer, amount, block_number, tx_hash, created_at FROM referral_rebates ORDER BY id DESC LIMIT 1");
      dbStatus.referralRebates = {
        configured: Boolean((process.env.VAULT_CORE_ADDRESS ?? process.env.DEPLOYED_VAULT_CORE ?? "").trim()),
        totalRows: rebateCount.rows[0].count,
        totalAmountRaw: rebateSum.rows[0].total,
        latest: latestRebate.rows[0] || null,
      };
    } catch (rebateErr) {
      // Table may not exist yet on first boot (created lazily by sync initDB).
      dbStatus.referralRebates = { error: String(rebateErr) };
    }

    const latestOpenEvent = await pool.query("SELECT * FROM position_events WHERE event_type = 'PositionOpened' ORDER BY id DESC LIMIT 1");
    dbStatus.latestOpenEvent = latestOpenEvent.rows[0] || null;

    const rawVolumeStats = await pool.query(`
      WITH opened_sizes AS (
        SELECT DISTINCT ON (position_id)
          position_id,
          size_raw,
          market_id AS open_market_id
        FROM position_events
        WHERE event_type = 'PositionOpened' AND position_id IS NOT NULL
        ORDER BY position_id, id ASC
      )
      SELECT 
        LOWER(CASE 
          WHEN c.market_id IS NOT NULL AND c.market_id <> '0x' THEN c.market_id
          ELSE o.open_market_id
        END) AS market_id,
        COALESCE(SUM(
          CASE
            WHEN c.event_type = 'PositionOpened' AND c.size_raw IS NOT NULL
              THEN c.size_raw / POWER(10::numeric, 18)
            WHEN c.event_type IN ('PositionClosed', 'PositionLiquidated') AND o.size_raw IS NOT NULL
              THEN o.size_raw / POWER(10::numeric, 18)
            ELSE 0::numeric
          END
        ), 0)::text AS volume24h,
        COUNT(*)::int AS trades24h
      FROM position_events c
      LEFT JOIN opened_sizes o ON o.position_id = c.position_id
      WHERE c.event_type IN ('PositionOpened', 'PositionClosed', 'PositionLiquidated')
        AND c.position_id IS NOT NULL
        AND (
          (c.block_time IS NOT NULL AND c.block_time >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '25 hours'))::bigint)
          OR 
          (c.block_time IS NULL AND c.created_at >= NOW() - INTERVAL '25 hours')
        )
      GROUP BY 1
    `);
    dbStatus.rawVolumeStats = rawVolumeStats.rows;
  } catch (err) {
    dbStatus.error = String(err);
    if (process.env.NODE_ENV !== "production" && err instanceof Error && err.stack) {
      dbStatus.stack = err.stack;
    }
  }

  return res.json(dbStatus);
});

export default router;
