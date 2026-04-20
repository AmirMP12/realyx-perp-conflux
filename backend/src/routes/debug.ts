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

    const last24h = await pool.query("SELECT COUNT(*) FROM position_events WHERE created_at >= NOW() - INTERVAL '24 hours'");
    dbStatus.last24hEvents = last24h.rows[0].count;

    const state = await pool.query("SELECT last_synced_block FROM indexer_state WHERE key = 'trading_core'");
    dbStatus.lastSyncedBlock = state.rows[0] ? state.rows[0].last_synced_block : "None";

    const sample = await pool.query("SELECT * FROM position_events LIMIT 1");
    dbStatus.sampleRow = sample.rows[0] ? sample.rows[0] : null;

    dbStatus.testJsonExtract = null;
    if (sample.rows[0]) {
      const jsonRes = await pool.query("SELECT (data::jsonb->>4) as size FROM position_events WHERE event_type = 'PositionOpened' LIMIT 1");
      dbStatus.testJsonExtract = jsonRes.rows[0] ? jsonRes.rows[0].size : "No open position data";
    }
  } catch (err) {
    dbStatus.error = String(err);
    if (err instanceof Error && err.stack) dbStatus.stack = err.stack;
  }

  return res.json(dbStatus);
});

export default router;
