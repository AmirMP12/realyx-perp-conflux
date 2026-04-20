import express from "express";
import { ethers } from "ethers";
import pg from "pg";
import { config } from "../config.js";
const TRADING_CORE_SYNC_ABI = [
    "event PositionOpened(uint256 indexed positionId, address indexed trader, address indexed market, bool isLong, uint256 size, uint256 leverage, uint256 entryPrice)",
    "event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnL, uint256 exitPrice, uint256 closingFee)",
    "event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 liquidationFee)",
];
const router = express.Router();
let poolInstance = null;
function getPool() {
    if (poolInstance)
        return poolInstance;
    if (!process.env.POSTGRES_URL)
        return null;
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
function getProvider() {
    return new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
}
async function initDB() {
    const pool = getPool();
    if (!pool)
        return;
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        block_time BIGINT
      );
      CREATE TABLE IF NOT EXISTS indexer_state (
        key VARCHAR(50) PRIMARY KEY,
        last_synced_block BIGINT NOT NULL,
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS size_usd NUMERIC DEFAULT 0;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS block_time BIGINT;
    `);
    }
    catch (error) {
        console.error("Failed to initialize database:", error);
    }
}
export async function runSync(options) {
    const pool = getPool();
    if (!pool) {
        throw new Error("Database not configured");
    }
    await initDB();
    const provider = getProvider();
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
    const CHUNK = 50000;
    const startTime = Date.now();
    const TIMEOUT_MS = 7500; // 7.5s safety limit for Vercel
    while (currentStart <= latestBlock) {
        // Stop if we're approaching the serverless timeout limit
        if (Date.now() - startTime > TIMEOUT_MS) {
            console.log(`[sync] Timeout reached after ${Date.now() - startTime}ms. Progress: ${finalTo}`);
            break;
        }
        const currentTo = Math.min(currentStart + CHUNK, latestBlock);
        const batchLogs = await provider.getLogs({
            address: tradingCoreAddress,
            fromBlock: currentStart,
            toBlock: currentTo,
            topics: [targetTopics]
        });
        totalSynced += await processLogs(batchLogs, iface, pool, provider);
        finalTo = currentTo;
        if (currentTo >= latestBlock)
            break;
        currentStart = currentTo + 1;
    }
    await pool.query(`INSERT INTO indexer_state (key, last_synced_block, last_synced_at) VALUES ('trading_core', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET 
       last_synced_block = EXCLUDED.last_synced_block,
       last_synced_at = NOW()`, [finalTo]);
    const duration = Date.now() - startTime;
    return {
        success: true,
        eventsSynced: totalSynced,
        scannedFrom: startBlock,
        scannedTo: finalTo,
        latestBlock,
        durationMs: duration,
        isCaughtUp: finalTo >= latestBlock
    };
}
const blockTimeCache = new Map();
async function getBlockTime(blockNumber, provider) {
    const cached = blockTimeCache.get(blockNumber);
    if (cached)
        return cached;
    try {
        const block = await provider.getBlock(blockNumber);
        const t = block?.timestamp ?? Math.floor(Date.now() / 1000);
        blockTimeCache.set(blockNumber, t);
        if (blockTimeCache.size > 2000) {
            const firstKey = blockTimeCache.keys().next().value;
            if (firstKey !== undefined)
                blockTimeCache.delete(firstKey);
        }
        return Number(t);
    }
    catch (err) {
        console.error(`Failed to fetch block time for ${blockNumber}:`, err);
        return Math.floor(Date.now() / 1000);
    }
}
async function processLogs(logs, iface, pool, provider) {
    let inserted = 0;
    let lastBlock = -1;
    let lastTime = 0;
    for (const log of logs) {
        try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (!parsed)
                continue;
            let account = log.address;
            let marketId = "0x";
            let sizeUsd = "0";
            // Optimize block time fetching within a batch
            let blockTime;
            if (log.blockNumber === lastBlock) {
                blockTime = lastTime;
            }
            else {
                blockTime = await getBlockTime(log.blockNumber, provider);
                lastBlock = log.blockNumber;
                lastTime = blockTime;
            }
            if (parsed.name === "PositionOpened") {
                account = String(parsed.args[1]).toLowerCase();
                marketId = String(parsed.args[2]).toLowerCase();
                sizeUsd = (Number(parsed.args[4]) / 1e18).toFixed(18);
            }
            else if (parsed.name === "PositionClosed" || parsed.name === "PositionLiquidated") {
                const posId = String(parsed.args[0]);
                if (parsed.name === "PositionClosed")
                    account = String(parsed.args[1]).toLowerCase();
                try {
                    // Robust resolution: try column first, then JSON fallback
                    const openEvt = await pool.query(`SELECT account, market_id, data FROM position_events 
             WHERE event_type = 'PositionOpened' AND (data::jsonb->>0)::text = $1 
             ORDER BY id DESC LIMIT 1`, [posId]);
                    if (openEvt.rows.length > 0) {
                        const row = openEvt.rows[0];
                        marketId = (row.market_id && row.market_id !== "0x")
                            ? row.market_id.toLowerCase()
                            : String(Array.isArray(row.data) ? row.data[2] : row.data?.market || "0x").toLowerCase();
                        account = row.account ? row.account.toLowerCase() : account;
                    }
                }
                catch { /* ignore */ }
            }
            const eventData = JSON.stringify(parsed.args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg));
            await pool.query(`INSERT INTO position_events (account, market_id, size_usd, event_type, block_number, tx_hash, data, block_time) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [account, marketId, sizeUsd, parsed.name, log.blockNumber, log.transactionHash, eventData, blockTime]);
            inserted++;
        }
        catch (err) {
            console.error("Parse error", err);
        }
    }
    return inserted;
}
/** Repair missing block_time for recent events */
async function runRepair(pool, provider) {
    try {
        const missing = await pool.query(`
      SELECT id, block_number FROM position_events 
      WHERE block_time IS NULL 
      ORDER BY id DESC LIMIT 50
    `);
        if (missing.rows.length === 0)
            return;
        console.log(`[repair] Fixing ${missing.rows.length} events missing block_time...`);
        for (const row of missing.rows) {
            const t = await getBlockTime(row.block_number, provider);
            await pool.query(`UPDATE position_events SET block_time = $1 WHERE id = $2`, [t, row.id]);
        }
    }
    catch (err) {
        console.error("[repair] failure:", err);
    }
}
/** Triggered by API traffic when Crons are unavailable. */
export async function checkAndSync() {
    const pool = getPool();
    if (!pool)
        return;
    try {
        const res = await pool.query(`SELECT last_synced_at FROM indexer_state WHERE key = 'trading_core'`);
        const lastSync = res.rows[0]?.last_synced_at;
        const now = new Date();
        // If no sync yet or last sync > 30s ago
        if (!lastSync || (now.getTime() - new Date(lastSync).getTime() > 30 * 1000)) {
            console.log("[lazy-sync] Data is stale, starting catch-up pulse...");
            // Await the sync pulse so Vercel doesn't kill the process before it makes progress
            const provider = getProvider();
            await runSync().catch(err => console.error("[lazy-sync] failure:", err));
            if (provider)
                await runRepair(pool, provider).catch(() => { });
        }
    }
    catch (err) {
        console.error("[lazy-sync] check failure:", err);
    }
}
router.get("/", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const { key, fromBlock: fromBlockQuery } = req.query;
        if (process.env.CRON_SECRET &&
            authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
            key !== "force") {
            return res.status(401).json({ success: false, error: "Unauthorized cron request." });
        }
        const fromBlock = fromBlockQuery ? parseInt(fromBlockQuery, 10) : undefined;
        const result = await runSync({ fromBlock });
        res.json(result);
    }
    catch (error) {
        console.error("Sync error:", error);
        res.status(500).json({ success: false, error: String(error) });
    }
});
export default router;
