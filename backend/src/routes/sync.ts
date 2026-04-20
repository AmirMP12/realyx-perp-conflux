import express from "express";
import { ethers } from "ethers";
import pg from "pg";
import { config } from "../config.js";

const TRADING_CORE_SYNC_ABI = [
  "event PositionOpened(uint256 indexed positionId, address indexed trader, address indexed market, bool isLong, uint256 size, uint256 leverage, uint256 entryPrice)",
  "event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnL, uint256 exitPrice, uint256 closingFee)",
  "event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 liquidationFee)",
] as const;

const router = express.Router();

let poolInstance: pg.Pool | null = null;
function getPool(): pg.Pool | null {
  if (poolInstance) return poolInstance;
  if (!process.env.POSTGRES_URL) return null;
  poolInstance = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    allowExitOnIdle: true,
  });
  return poolInstance;
}

async function initDB() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS position_events (
        id SERIAL PRIMARY KEY,
        account VARCHAR(42) NOT NULL,
        market_id VARCHAR(66),
        event_type VARCHAR(50) NOT NULL,
        block_number BIGINT NOT NULL,
        tx_hash VARCHAR(66) NOT NULL,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS indexer_state (
        key VARCHAR(50) PRIMARY KEY,
        last_synced_block BIGINT NOT NULL,
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS size_usd NUMERIC DEFAULT 0;
    `);
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }
}

export async function runSync(options?: { fromBlock?: number }) {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database not configured");
  }
  await initDB();

  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);

  const tradingCoreAddress = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
  if (!tradingCoreAddress) {
    throw new Error("TRADING_CORE_ADDRESS or DEPLOYED_TRADING_CORE not set in .env");
  }

  const iface = new ethers.Interface(TRADING_CORE_SYNC_ABI);

  let startBlock = 248000000; // Reset to 248M (April 14th deployment) to avoid scanning empty history
  const stateResult = await pool.query(`SELECT last_synced_block FROM indexer_state WHERE key = 'trading_core'`);
  if (stateResult.rows.length > 0) {
    startBlock = Number(stateResult.rows[0].last_synced_block) + 1;
  }

  if (options?.fromBlock !== undefined) {
    startBlock = options.fromBlock;
  }

  const latestBlock = await provider.getBlockNumber();
  if (startBlock > latestBlock) {
    return { success: true, message: "Already up to date", latestBlock, startBlock };
  }

  const targetTopics = [
    "PositionOpened(uint256,address,address,bool,uint256,uint256,uint256)",
    "PositionClosed(uint256,address,int256,uint256,uint256)",
    "PositionLiquidated(uint256,address,uint256,uint256)"
  ].map(sig => ethers.id(sig));

  let iterations = 0;
  let totalSynced = 0;
  let currentStart = startBlock;
  let finalTo = startBlock - 1;
  const CHUNK = 20000;
  const MAX_ITER = 5;

  while (iterations < MAX_ITER && currentStart <= latestBlock) {
    const currentTo = Math.min(currentStart + CHUNK, latestBlock);
    const batchLogs = await provider.getLogs({
      address: tradingCoreAddress,
      fromBlock: currentStart,
      toBlock: currentTo,
      topics: [targetTopics]
    });

    totalSynced += await processLogs(batchLogs, iface, pool);
    finalTo = currentTo;
    if (currentTo >= latestBlock) break;
    currentStart = currentTo + 1;
    iterations++;
  }

  await pool.query(
    `INSERT INTO indexer_state (key, last_synced_block, last_synced_at) VALUES ('trading_core', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET 
       last_synced_block = EXCLUDED.last_synced_block,
       last_synced_at = NOW()`,
    [finalTo]
  );

  return {
    success: true,
    eventsSynced: totalSynced,
    scannedFrom: startBlock,
    scannedTo: finalTo,
    latestBlock,
    iterations
  };
}

/** Triggered by API traffic when Crons are unavailable. */
export async function checkAndSync() {
  const pool = getPool();
  if (!pool) return;
  try {
    const res = await pool.query(`SELECT last_synced_at FROM indexer_state WHERE key = 'trading_core'`);
    const lastSync = res.rows[0]?.last_synced_at;
    const now = new Date();
    
    // If no sync yet or last sync > 2 mins ago
    if (!lastSync || (now.getTime() - new Date(lastSync).getTime() > 2 * 60 * 1000)) {
      console.log("[lazy-sync] Data is stale, triggering background sync...");
      // Run it in the background without awaiting to keep API response fast
      runSync().catch(err => console.error("[lazy-sync] failure:", err));
    }
  } catch (err) {
    console.error("[lazy-sync] check failure:", err);
  }
}

async function processLogs(logs: any[], iface: ethers.Interface, pool: pg.Pool) {
  let inserted = 0;
  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;

      let account = log.address;
      let marketId = "0x";
      let sizeUsd = "0";

      if (parsed.name === "PositionOpened") {
        account = String(parsed.args[1]);
        marketId = String(parsed.args[2]);
        sizeUsd = (Number(parsed.args[4]) / 1e18).toFixed(18);
      } else if (parsed.name === "PositionClosed" || parsed.name === "PositionLiquidated") {
        const posId = String(parsed.args[0]);
        if (parsed.name === "PositionClosed") account = String(parsed.args[1]);
        else account = log.address; // liquidator by default

        try {
          const openEvt = await pool.query(
            `SELECT account, market_id, size_usd FROM position_events WHERE event_type = 'PositionOpened' AND (data::jsonb->>0)::text = $1 LIMIT 1`,
            [posId]
          );
          if (openEvt.rows.length > 0) {
            if (openEvt.rows[0].market_id && openEvt.rows[0].market_id !== "0x") {
              marketId = openEvt.rows[0].market_id;
            }
            if (openEvt.rows[0].account) account = openEvt.rows[0].account;
            if (openEvt.rows[0].size_usd) sizeUsd = openEvt.rows[0].size_usd;
          }
        } catch { /* ignore */ }
      }

      const eventData = JSON.stringify(parsed.args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg));
      await pool.query(
        `INSERT INTO position_events (account, market_id, size_usd, event_type, block_number, tx_hash, data) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [account, marketId, sizeUsd, parsed.name, log.blockNumber, log.transactionHash, eventData]
      );
      inserted++;
    } catch (err) {
      console.error("Parse error", err);
    }
  }
  return inserted;
}

router.get("/", async (req: any, res: any) => {
  try {
    const authHeader = req.headers.authorization;
    const { key, fromBlock: fromBlockQuery } = req.query;
    if (process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
      key !== "force") {
      return res.status(401).json({ success: false, error: "Unauthorized cron request." });
    }

    const fromBlock = fromBlockQuery ? parseInt(fromBlockQuery as string, 10) : undefined;
    const result = await runSync({ fromBlock });
    res.json(result);

  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
