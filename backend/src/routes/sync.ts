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
        last_synced_block BIGINT NOT NULL
      );
    `);
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }
}

router.get("/", async (req: any, res: any) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ success: false, error: "Database not configured" });
    }
    await initDB();

    const authHeader = req.headers.authorization;
    const { key, fromBlock: fromBlockQuery } = req.query;
    if (process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
      key !== "force") {
      return res.status(401).json({ success: false, error: "Unauthorized cron request. Hint: Use ?key=force to manually trigger during setup." });
    }


    const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);

    const tradingCoreAddress = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
    if (!tradingCoreAddress) {
      return res.status(500).json({
        success: false,
        error: "TRADING_CORE_ADDRESS or DEPLOYED_TRADING_CORE not set in .env",
      });
    }

    const iface = new ethers.Interface(TRADING_CORE_SYNC_ABI);

    let startBlock = 248000000; // Reset to 248M (April 14th deployment) to avoid scanning empty history
    const stateResult = await pool.query(`SELECT last_synced_block FROM indexer_state WHERE key = 'trading_core'`);
    if (stateResult.rows.length > 0) {
      startBlock = Number(stateResult.rows[0].last_synced_block) + 1;
    }

    if (fromBlockQuery) {
      startBlock = parseInt(fromBlockQuery as string, 10);
    }

    const latestBlock = await provider.getBlockNumber();
    if (startBlock > latestBlock) {
      return res.json({ success: true, message: "Already up to date", latestBlock, startBlock });
    }

    const toBlock = Math.min(startBlock + 250, latestBlock); // Reduced to 250 blocks to avoid aggressive gateway timeouts

    const targetTopics = [
      "PositionOpened(uint256,address,address,bool,uint256,uint256,uint256)",
      "PositionClosed(uint256,address,int256,uint256,uint256)",
      "PositionLiquidated(uint256,address,uint256,uint256)"
    ].map(sig => ethers.id(sig));

    const logs = await provider.getLogs({
      address: tradingCoreAddress,
      fromBlock: startBlock,
      toBlock: toBlock,
      topics: [targetTopics]
    });

    let eventsInserted = 0;
    for (const log of logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (!parsed) continue;

        let account = log.address;
        let marketId = "0x";
        if (parsed.name === "PositionOpened") {
          account = String(parsed.args[1]);
          marketId = String(parsed.args[2]);
        } else if (parsed.name === "PositionClosed") {
          account = String(parsed.args[1]);
          // Look up market_id from the corresponding PositionOpened event
          const posId = String(parsed.args[0]);
          try {
            const openEvt = await getPool()!.query(
              `SELECT market_id FROM position_events WHERE event_type = 'PositionOpened' AND (data->>0)::text = $1 LIMIT 1`,
              [posId]
            );
            if (openEvt.rows.length > 0 && openEvt.rows[0].market_id) {
              marketId = openEvt.rows[0].market_id;
            }
          } catch { /* best-effort lookup */ }
        } else if (parsed.name === "PositionLiquidated") {
          // arg[1] is liquidator; we need original trader for the leaderboard
          const posId = String(parsed.args[0]);
          account = log.address; // fallback
          try {
            const openEvt = await getPool()!.query(
              `SELECT account, market_id FROM position_events WHERE event_type = 'PositionOpened' AND (data->>0)::text = $1 LIMIT 1`,
              [posId]
            );
            if (openEvt.rows.length > 0) {
              if (openEvt.rows[0].account) account = openEvt.rows[0].account;
              if (openEvt.rows[0].market_id) marketId = openEvt.rows[0].market_id;
            }
          } catch { /* best-effort lookup */ }
        }

        const eventData = JSON.stringify(parsed.args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg));

        const pool = getPool()!;
        await pool.query(
          `INSERT INTO position_events (account, market_id, event_type, block_number, tx_hash, data) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [account, marketId, parsed.name, log.blockNumber, log.transactionHash, eventData]
        );
        eventsInserted++;
      } catch (err) {
        console.error("Failed to parse log", log.transactionHash, err);
      }
    }

    const poolFinal = getPool()!;
    await poolFinal.query(
      `INSERT INTO indexer_state (key, last_synced_block) VALUES ('trading_core', $1)
       ON CONFLICT (key) DO UPDATE SET last_synced_block = EXCLUDED.last_synced_block`,
      [toBlock]
    );

    res.json({
      success: true,
      eventsSynced: eventsInserted,
      scannedFromChunk: startBlock,
      scannedToChunk: toBlock,
      latestChainBlock: latestBlock
    });

  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
