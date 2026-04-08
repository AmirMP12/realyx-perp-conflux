import express from "express";
import { ethers } from "ethers";
import pg from "pg";
import { config } from "../config.js";
import TradingCoreABI from "../../abi/TradingCore.json" with { type: "json" };
import VaultCoreABI from "../../abi/VaultCore.json" with { type: "json" };

const router = express.Router();
const { Pool } = pg;

// Use Vercel Postgres URL or any standard DB string
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});

// Initialize schema (best-effort locally, usually you'd run a migration)
async function initDB() {
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

// Call on boot
initDB();

router.get("/", async (req, res) => {
  try {
    if (!process.env.POSTGRES_URL) {
      return res.status(500).json({ success: false, error: "POSTGRES_URL not configured. Add it to Vercel Environment Variables." });
    }
    
    // Vercel Cron sends a secret header. If configured, enforce it.
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ success: false, error: "Unauthorized cron request" });
    }

    const provider = new ethers.JsonRpcProvider(
      config.chainId === 1030 
        ? "https://evm.confluxrpc.com" 
        : "https://evmtestnet.confluxrpc.com"
    );

    const tradingCoreAddress = process.env.TRADING_CORE_ADDRESS;
    if (!tradingCoreAddress) {
      return res.status(500).json({ success: false, error: "TRADING_CORE_ADDRESS not set in .env" });
    }

    const iface = new ethers.Interface((TradingCoreABI as any).abi || TradingCoreABI);

    // Track state
    let startBlock = 160000000; // sensible default for Conflux eSpace testnet
    const stateResult = await pool.query(`SELECT last_synced_block FROM indexer_state WHERE key = 'trading_core'`);
    if (stateResult.rows.length > 0) {
      startBlock = Number(stateResult.rows[0].last_synced_block) + 1;
    }

    const latestBlock = await provider.getBlockNumber();
    if (startBlock > latestBlock) {
      return res.json({ success: true, message: "Already up to date", latestBlock });
    }

    // Process blocks in batches of 2000 to prevent RPC rate limits/timeouts
    const toBlock = Math.min(startBlock + 2000, latestBlock);

    // Define the event signatures you care about
    // Update these strings to exactly match your Solidity event signatures if needed!
    const targetTopics = [
      "PositionOpened(address,bytes32,bool,uint256,uint256,uint256)",
      "PositionClosed(address,bytes32,uint256,int256)",
      "PositionLiquidated(address,bytes32,address,uint256)"
    ].map(sig => ethers.id(sig));

    // Fetch logs
    const logs = await provider.getLogs({
      address: tradingCoreAddress,
      fromBlock: startBlock,
      toBlock: toBlock,
      // Filtering for ANY of the target event topics in the first position
      topics: [targetTopics]
    });

    let eventsInserted = 0;
    for (const log of logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (!parsed) continue;

        // Extract raw args. Position usually has the User address as the first param (index 0).
        // Safely extract whatever arguments match the event signature.
        const account = parsed.args[0] ?? log.address;
        const marketId = parsed.args[1] ? String(parsed.args[1]) : "0x";
        
        // Serialize the rest of the arguments to JSONB for frontend consumption
        const eventData = JSON.stringify(parsed.args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg));

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

    // Save our place so the next minute's cron picks up exactly where we left off
    await pool.query(
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
