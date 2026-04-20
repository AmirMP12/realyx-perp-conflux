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

    const latest = await pool.query("SELECT id, event_type, market_id, block_number, block_time, created_at FROM position_events ORDER BY id DESC LIMIT 5");
    dbStatus.latestEvents = latest.rows;

    const sampleOpen = await pool.query("SELECT * FROM position_events WHERE event_type = 'PositionOpened' ORDER BY id DESC LIMIT 1");
    dbStatus.latestOpenEvent = sampleOpen.rows[0] || null;
  } catch (err) {
    dbStatus.error = String(err);
    if (err instanceof Error && err.stack) dbStatus.stack = err.stack;
  }

  return res.json(dbStatus);
});

export default router;
