import { Router, Request, Response } from "express";
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

router.get("/", async (req: Request, res: Response) => {
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

    const latestOpenEvent = await pool.query("SELECT * FROM position_events WHERE event_type = 'PositionOpened' ORDER BY id DESC LIMIT 1");
    dbStatus.latestOpenEvent = latestOpenEvent.rows[0] || null;

    const rawVolumeStats = await pool.query(`
      WITH opened_sizes AS (
        SELECT DISTINCT ON ((data::jsonb->>0)::text)
          (data::jsonb->>0)::text AS position_id,
          (data::jsonb->>4)::numeric AS size_raw,
          (data::jsonb->>2)::text AS open_market_id
        FROM position_events
        WHERE event_type = 'PositionOpened'
        ORDER BY (data::jsonb->>0)::text, id ASC
      )
      SELECT 
        LOWER(CASE 
          WHEN c.market_id IS NOT NULL AND c.market_id <> '0x' THEN c.market_id
          WHEN c.event_type = 'PositionOpened' THEN (c.data->>2)::text
          ELSE o.open_market_id
        END) AS market_id,
        COALESCE(SUM(
          CASE
            WHEN c.size_usd > 0 THEN c.size_usd
            WHEN c.event_type = 'PositionOpened' AND c.data::jsonb->>4 IS NOT NULL
              THEN (c.data::jsonb->>4)::numeric / POWER(10::numeric, 18)
            WHEN c.event_type IN ('PositionClosed', 'PositionLiquidated') AND o.size_raw IS NOT NULL
              THEN o.size_raw / POWER(10::numeric, 18)
            ELSE 0::numeric
          END
        ), 0)::text AS volume24h,
        COUNT(*)::int AS trades24h
      FROM position_events c
      LEFT JOIN opened_sizes o ON o.position_id = (c.data::jsonb->>0)::text
      WHERE c.event_type IN ('PositionOpened', 'PositionClosed', 'PositionLiquidated')
        AND c.data IS NOT NULL
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
    if (err instanceof Error && err.stack) dbStatus.stack = err.stack;
  }

  return res.json(dbStatus);
});

export default router;
