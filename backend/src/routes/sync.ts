import express from "express";
import { ethers } from "ethers";
import pg from "pg";
import { config } from "../config.js";
import { setIndexerLag, recordIndexerReorg } from "../middleware/metrics.js";

// ── Indexer tuning ────────────────────────────────────────────────────────
// Largest getLogs window; halved on RPC failure and grown back on success so a
// hot range can't permanently wedge the sync loop (was a fixed 50k window).
const MAX_CHUNK = Math.max(1000, Number(process.env.INDEXER_MAX_CHUNK ?? "50000"));
const MIN_CHUNK = Math.max(100, Number(process.env.INDEXER_MIN_CHUNK ?? "1000"));
// Fallback rewind depth used only when block-hash checkpointing can't pinpoint
// the reorg (no stored hashes in range, or the RPC won't serve block headers).
// In the common case the indexer now detects reorgs precisely by walking the
// stored block-hash chain back to the common ancestor, so it never blindly
// re-scans this window on a healthy resume (a big efficiency win over the old
// "purge + re-ingest 64 blocks every pulse" behaviour).
const REORG_BUFFER_BLOCKS = Math.max(0, Number(process.env.INDEXER_REORG_BUFFER ?? "64"));
// How many recent (block_number, block_hash) checkpoints to retain for reorg
// walk-back. Bounds the depth of reorg we can resolve precisely; anything
// deeper falls back to REORG_BUFFER_BLOCKS. Conflux eSpace finalizes quickly so
// a few hundred blocks is ample headroom.
const BLOCK_HASH_RETENTION = Math.max(REORG_BUFFER_BLOCKS, Number(process.env.INDEXER_BLOCK_HASH_RETENTION ?? "512"));
// Postgres advisory-lock key: serializes concurrent sync pulses (cron + lazy
// sync, or a hot standby) so they can't interleave scans, double-insert, or
// rewind the cursor. Arbitrary constant, unique to the trading_core indexer.
const SYNC_ADVISORY_LOCK_KEY = 738_204_551;

const TRADING_CORE_SYNC_ABI = [
  "event PositionOpened(uint256 indexed positionId, address indexed trader, address indexed market, bool isLong, uint256 size, uint256 leverage, uint256 entryPrice)",
  "event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnL, uint256 exitPrice, uint256 closingFee)",
  "event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 liquidationFee)",
] as const;

/** VaultCore referral-rebate accrual; indexed so /api/referrals can sum cumulative earnings cheaply. */
const VAULT_REBATE_SYNC_ABI = [
  "event RebateAccrued(address indexed referrer, uint256 amount)",
] as const;

/** VaultCore bad-debt payouts; indexed so /api/insurance/claims can show real recent payouts. */
const VAULT_BAD_DEBT_SYNC_ABI = [
  "event BadDebtCovered(uint256 indexed claimId, uint256 amount, uint256 positionId)",
] as const;

/**
 * CopyRegistry social-trading events. Indexed so /api/v1/social/* can serve
 * real lead-trader and follow-relationship data instead of an empty/501 stub.
 * Lead-trader performance (ROI/PnL/win-rate) is derived separately from the
 * lead's own indexed position_events; these events only carry registration and
 * follow state.
 */
const COPY_REGISTRY_SYNC_ABI = [
  "event LeadTraderRegistered(uint256 indexed leadTraderId, address indexed trader, uint16 profitFeeBps, string metadataURI)",
  "event LeadTraderUpdated(uint256 indexed leadTraderId, uint16 profitFeeBps, string metadataURI)",
  "event FollowedTrader(address indexed copier, address indexed leadTrader, uint256 maxAllocation, uint8 maxLeverage)",
  "event UnfollowedTrader(address indexed copier, address indexed leadTrader)",
  "event CopierConfigUpdated(address indexed copier, address indexed leadTrader, uint256 maxAllocation, uint8 maxLeverage)",
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

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        block_time BIGINT
      );
      CREATE TABLE IF NOT EXISTS indexer_state (
        key VARCHAR(50) PRIMARY KEY,
        last_synced_block BIGINT NOT NULL,
        last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- ── Reorg-aware checkpointing ──
      -- Stores the canonical block hash for each scanned height so a resume can
      -- DETECT a reorg (stored hash != current on-chain hash) rather than blindly
      -- re-scanning a fixed window. On mismatch we walk back to the last height
      -- whose stored hash still matches the chain (the common ancestor), purge
      -- everything above it, and re-ingest from there. Conflux eSpace can reorg,
      -- and a naive cursor silently keeps orphaned-block events forever.
      CREATE TABLE IF NOT EXISTS block_checkpoints (
        key VARCHAR(50) NOT NULL,
        block_number BIGINT NOT NULL,
        block_hash VARCHAR(66) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (key, block_number)
      );
      CREATE INDEX IF NOT EXISTS idx_block_checkpoints_key_block
        ON block_checkpoints(key, block_number DESC);
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS size_usd NUMERIC DEFAULT 0;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS block_time BIGINT;
      -- Log position within its tx, needed for an idempotent uniqueness guard.
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS log_index INTEGER DEFAULT 0;

      -- ── Typed event columns ──
      -- Decoded ONCE from the event ABI at ingest so every read path uses real,
      -- indexable columns instead of fragile (data::jsonb->>N)::numeric magic
      -- indices. A single ABI reordering used to silently corrupt volume/PnL via
      -- those positional reads; with typed columns the decode lives in exactly
      -- one place (processLogs) and reads are unambiguous.
      --   position_id  — every event (uint256 positionId, args[0])
      --   is_long      — PositionOpened (bool isLong, args[3])
      --   size_raw     — PositionOpened notional, 1e18-scaled (args[4])
      --   leverage_raw — PositionOpened leverage, 1e18-scaled (args[5])
      --   entry_price  — PositionOpened entry price (args[6])
      --   realized_pnl — PositionClosed realizedPnL, int256 (args[2])
      --   exit_price   — PositionClosed exitPrice (args[3]) / PositionLiquidated liquidationPrice (args[2])
      --   fee          — PositionClosed closingFee (args[4]) / PositionLiquidated liquidationFee (args[3])
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS position_id NUMERIC;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS is_long BOOLEAN;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS size_raw NUMERIC;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS leverage_raw NUMERIC;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS entry_price NUMERIC;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS exit_price NUMERIC;
      ALTER TABLE position_events ADD COLUMN IF NOT EXISTS fee NUMERIC;

      -- ── Idempotency / reorg safety ──
      -- A chain log is uniquely identified by (tx_hash, log_index). Without this
      -- guard, any overlapping re-scan (adaptive-chunk retries, the reorg
      -- re-scan window, or a cron overlapping a lazy-sync pulse) duplicated rows
      -- and inflated every COUNT(*)/SUM aggregate (volume, trades, leaderboard).
      -- De-duplicate any historical duplicates before adding the constraint so
      -- the index build can't fail on existing data.
      DELETE FROM position_events a
        USING position_events b
        WHERE a.id > b.id
          AND a.tx_hash = b.tx_hash
          AND a.log_index = b.log_index;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_events_txhash_logindex
        ON position_events(tx_hash, log_index);

      -- ── Indexes for the sliding-window volume/leaderboard scans ──
      -- The 24h-volume and per-market aggregates filter on block_time and group
      -- by market; without these the queries degrade to full-table scans as the
      -- event store grows. The (market_id, block_time) composite covers the
      -- per-market sliding window; the lone block_time index covers the global
      -- 24h/protocol-metrics scans; event_type narrows the volume CASE.
      CREATE INDEX IF NOT EXISTS idx_pos_events_block_time ON position_events(block_time);
      CREATE INDEX IF NOT EXISTS idx_pos_events_market_block_time ON position_events(market_id, block_time);
      CREATE INDEX IF NOT EXISTS idx_pos_events_type_block_time ON position_events(event_type, block_time);
      CREATE INDEX IF NOT EXISTS idx_pos_events_account ON position_events(account);
      -- Position-id lookups (close/liquidate → matching open) read data->>0 a lot.
      CREATE INDEX IF NOT EXISTS idx_pos_events_position_id ON position_events(((data::jsonb->>0)));
      -- Typed position-id index backing the open/close/liquidation joins now that
      -- those joins use the real position_id column instead of (data->>0).
      CREATE INDEX IF NOT EXISTS idx_pos_events_position_id_num ON position_events(position_id);

      -- ── One-time backfill of typed columns ──
      -- Populate the new columns for rows ingested before this migration.
      -- Idempotent (guarded on NULL so steady-state runs touch nothing) and
      -- bounded by numeric-format regexes so a malformed legacy row can never
      -- abort the migration with a cast error.
      UPDATE position_events SET position_id = (data::jsonb->>0)::numeric
        WHERE position_id IS NULL AND data IS NOT NULL AND (data::jsonb->>0) ~ '^[0-9]+$';
      UPDATE position_events SET
        is_long = ((data::jsonb->>3) = 'true'),
        size_raw = CASE WHEN (data::jsonb->>4) ~ '^[0-9]+$' THEN (data::jsonb->>4)::numeric END,
        leverage_raw = CASE WHEN (data::jsonb->>5) ~ '^[0-9]+$' THEN (data::jsonb->>5)::numeric END,
        entry_price = CASE WHEN (data::jsonb->>6) ~ '^[0-9]+$' THEN (data::jsonb->>6)::numeric END
        WHERE event_type = 'PositionOpened' AND size_raw IS NULL AND data IS NOT NULL;
      UPDATE position_events SET
        realized_pnl = CASE WHEN (data::jsonb->>2) ~ '^-?[0-9]+$' THEN (data::jsonb->>2)::numeric END,
        exit_price = CASE WHEN (data::jsonb->>3) ~ '^[0-9]+$' THEN (data::jsonb->>3)::numeric END,
        fee = CASE WHEN (data::jsonb->>4) ~ '^[0-9]+$' THEN (data::jsonb->>4)::numeric END
        WHERE event_type = 'PositionClosed' AND exit_price IS NULL AND data IS NOT NULL;
      UPDATE position_events SET
        exit_price = CASE WHEN (data::jsonb->>2) ~ '^[0-9]+$' THEN (data::jsonb->>2)::numeric END,
        fee = CASE WHEN (data::jsonb->>3) ~ '^[0-9]+$' THEN (data::jsonb->>3)::numeric END
        WHERE event_type = 'PositionLiquidated' AND exit_price IS NULL AND data IS NOT NULL;

      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        key_hash VARCHAR(64) NOT NULL UNIQUE,
        owner_address VARCHAR(42) NOT NULL,
        tier VARCHAR(10) NOT NULL DEFAULT 'FREE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_address);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

      -- One-time-use nonces for EIP-712 API-key issuance. The (owner, nonce)
      -- primary key makes each signed GenerateApiKey(owner, nonce) message a
      -- single-use grant: a replay hits the PK conflict and is rejected.
      CREATE TABLE IF NOT EXISTS api_key_nonces (
        owner_address VARCHAR(42) NOT NULL,
        nonce NUMERIC NOT NULL,
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (owner_address, nonce)
      );

      CREATE TABLE IF NOT EXISTS referral_rebates (
        id SERIAL PRIMARY KEY,
        referrer VARCHAR(42) NOT NULL,
        amount NUMERIC NOT NULL,
        block_number BIGINT NOT NULL,
        log_index INTEGER NOT NULL,
        tx_hash VARCHAR(66) NOT NULL,
        block_time BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS idx_referral_rebates_referrer ON referral_rebates(referrer);

      -- ── Insurance-fund payouts ──
      -- VaultCore emits BadDebtCovered(claimId, amount, positionId) whenever
      -- the insurance fund pays out against a bad-debt claim. Indexed here so
      -- /api/insurance/claims can surface real recent payouts. Idempotent via
      -- the (tx_hash, log_index) unique guard like every other event table.
      CREATE TABLE IF NOT EXISTS bad_debt_claims (
        id SERIAL PRIMARY KEY,
        claim_id NUMERIC NOT NULL,
        position_id NUMERIC NOT NULL,
        amount NUMERIC NOT NULL,
        block_number BIGINT NOT NULL,
        log_index INTEGER NOT NULL,
        tx_hash VARCHAR(66) NOT NULL,
        block_time BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS idx_bad_debt_claims_block ON bad_debt_claims(block_number DESC, log_index DESC);
    `);

    // ── Social / copy-trading schema ──
    // Populated from CopyRegistry events (lead_traders, copy_relationships) and
    // derived lead-trader performance (lead_trader_stats). copied_positions /
    // copier_stats back the copier-PnL endpoints; they stay empty until the
    // off-chain CopyBot actually mirrors trades, so those reads honestly report
    // zero rather than 500ing. Kept in a separate statement so a failure here
    // can never abort the core position-event migration above.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lead_traders (
        id BIGINT PRIMARY KEY,
        address VARCHAR(42) NOT NULL UNIQUE,
        profit_fee_bps INTEGER NOT NULL DEFAULT 0,
        metadata_uri TEXT DEFAULT '',
        active_followers INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_lead_traders_address ON lead_traders(address);

      CREATE TABLE IF NOT EXISTS lead_trader_stats (
        lead_trader_id BIGINT PRIMARY KEY REFERENCES lead_traders(id) ON DELETE CASCADE,
        total_pnl NUMERIC NOT NULL DEFAULT 0,
        roi NUMERIC NOT NULL DEFAULT 0,
        win_rate NUMERIC NOT NULL DEFAULT 0,
        total_trades INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS copy_relationships (
        id SERIAL PRIMARY KEY,
        copier_address VARCHAR(42) NOT NULL,
        lead_trader_address VARCHAR(42) NOT NULL,
        max_allocation NUMERIC NOT NULL DEFAULT 0,
        max_leverage INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT true,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (copier_address, lead_trader_address)
      );
      CREATE INDEX IF NOT EXISTS idx_copy_rel_copier ON copy_relationships(copier_address);
      CREATE INDEX IF NOT EXISTS idx_copy_rel_lead ON copy_relationships(lead_trader_address);

      -- Copier performance tables. Filled by the CopyBot once trade mirroring
      -- is live; the JOINs in /copier/:address/* tolerate them being empty.
      CREATE TABLE IF NOT EXISTS copier_stats (
        copier_address VARCHAR(42) NOT NULL,
        lead_trader_address VARCHAR(42) NOT NULL,
        total_pnl NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (copier_address, lead_trader_address)
      );

      CREATE TABLE IF NOT EXISTS copied_positions (
        id SERIAL PRIMARY KEY,
        copier_address VARCHAR(42) NOT NULL,
        lead_trader_address VARCHAR(42) NOT NULL,
        position_id NUMERIC,
        realized_pnl NUMERIC NOT NULL DEFAULT 0,
        unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_copied_pos_copier_lead
        ON copied_positions(copier_address, lead_trader_address);
    `);
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }
}

/**
 * Persist the indexer cursor. Idempotent upsert of the highest fully-scanned
 * block. Called incrementally after each successful chunk so a mid-run timeout
 * or crash never loses ground or re-wedges on a hot range.
 */
async function persistCursor(pool: pg.Pool, block: number): Promise<void> {
  await pool.query(
    `INSERT INTO indexer_state (key, last_synced_block, last_synced_at) VALUES ('trading_core', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET
       last_synced_block = EXCLUDED.last_synced_block,
       last_synced_at = NOW()`,
    [block]
  );
}

const INDEXER_KEY = "trading_core";

/**
 * Record the canonical block hash for a scanned height (used for reorg
 * detection on the next resume) and prune checkpoints older than the retention
 * window so the table stays bounded. Best-effort: a checkpointing failure must
 * never abort ingestion, so callers swallow errors.
 */
async function persistBlockHash(pool: pg.Pool, blockNumber: number, blockHash: string): Promise<void> {
  if (!blockHash) return;
  await pool.query(
    `INSERT INTO block_checkpoints (key, block_number, block_hash) VALUES ($1, $2, $3)
     ON CONFLICT (key, block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash, created_at = NOW()`,
    [INDEXER_KEY, blockNumber, blockHash]
  );
  // Prune anything older than the retention window relative to this height.
  await pool.query(
    `DELETE FROM block_checkpoints WHERE key = $1 AND block_number < $2`,
    [INDEXER_KEY, blockNumber - BLOCK_HASH_RETENTION]
  );
}

/**
 * Reorg-aware resume point.
 *
 * Compares stored block hashes (newest → oldest) against the live chain. The
 * first height whose stored hash still matches the chain is the common
 * ancestor; everything above it is orphaned and must be re-ingested. Returns:
 *   - safeBlock: highest still-canonical scanned height (-1 if none stored)
 *   - reorgDepth: how many trailing checkpoints were orphaned (0 = no reorg)
 *   - usedFallback: true when no stored hash matched (or headers were
 *     unavailable) and the caller should fall back to a fixed-window rewind.
 *
 * On a healthy resume the very newest checkpoint matches, so this is a single
 * getBlock call and we DON'T re-scan anything — unlike the old unconditional
 * 64-block purge.
 */
async function findReorgSafeResume(
  pool: pg.Pool,
  provider: ethers.Provider,
  lastSyncedBlock: number,
): Promise<{ safeBlock: number; reorgDepth: number; usedFallback: boolean }> {
  let checkpoints: Array<{ block_number: string | number; block_hash: string }>;
  try {
    const res = await pool.query(
      `SELECT block_number, block_hash FROM block_checkpoints
       WHERE key = $1 AND block_number <= $2
       ORDER BY block_number DESC
       LIMIT $3`,
      [INDEXER_KEY, lastSyncedBlock, BLOCK_HASH_RETENTION]
    );
    checkpoints = res.rows;
  } catch (e) {
    console.error("[sync] checkpoint read failed; using fixed-window rewind:", e);
    return { safeBlock: lastSyncedBlock - REORG_BUFFER_BLOCKS, reorgDepth: 0, usedFallback: true };
  }

  // No stored hashes (first run after this upgrade, or pruned) → fixed rewind.
  if (checkpoints.length === 0) {
    return { safeBlock: lastSyncedBlock - REORG_BUFFER_BLOCKS, reorgDepth: 0, usedFallback: true };
  }

  let reorgDepth = 0;
  for (const cp of checkpoints) {
    const bn = Number(cp.block_number);
    let canonicalHash: string | null;
    try {
      const block = await provider.getBlock(bn);
      canonicalHash = block?.hash ?? null;
    } catch (e) {
      console.warn(`[sync] getBlock(${bn}) failed during reorg check:`, (e as any)?.message ?? e);
      // Can't verify this height — stop walking and fall back conservatively.
      return { safeBlock: lastSyncedBlock - REORG_BUFFER_BLOCKS, reorgDepth, usedFallback: true };
    }
    if (canonicalHash && canonicalHash.toLowerCase() === String(cp.block_hash).toLowerCase()) {
      // Common ancestor found: this height is still canonical.
      return { safeBlock: bn, reorgDepth, usedFallback: false };
    }
    // Hash mismatch (or missing) → this checkpoint is orphaned; keep walking back.
    reorgDepth++;
  }

  // Walked the entire retained range without finding a match: the reorg is
  // deeper than we retain. Re-scan the whole retained window to be safe.
  const oldest = Number(checkpoints[checkpoints.length - 1].block_number);
  return { safeBlock: oldest - 1, reorgDepth, usedFallback: true };
}

/**
 * Acquire a Postgres advisory lock so only one sync pulse runs at a time.
 * Without this, the cron job overlapping a lazy-sync pulse (or a hot standby)
 * could interleave scans, double-insert, and even rewind the cursor.
 *
 * Returns a release function on success, or null if another pulse holds the
 * lock (caller should no-op). Skipped under tests, where `pool` is a mock
 * without a real `connect()`; the unit suite drives `runSync` directly.
 */
async function acquireSyncLock(pool: pg.Pool): Promise<(() => Promise<void>) | null> {
  if (process.env.NODE_ENV === "test" || typeof (pool as any).connect !== "function") {
    return async () => { /* no-op in test / mock pools */ };
  }
  const client = await pool.connect();
  try {
    const r = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [SYNC_ADVISORY_LOCK_KEY]);
    if (!r.rows[0]?.locked) {
      client.release();
      return null;
    }
    return async () => {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [SYNC_ADVISORY_LOCK_KEY]);
      } finally {
        client.release();
      }
    };
  } catch (e) {
    client.release();
    throw e;
  }
}

export async function runSync(options?: { fromBlock?: number }) {
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

  const release = await acquireSyncLock(pool);
  if (!release) {
    return { success: true, skipped: true, message: "Another sync pulse is in progress" };
  }

  try {
    const iface = new ethers.Interface(TRADING_CORE_SYNC_ABI);
    const rebateIface = new ethers.Interface(VAULT_REBATE_SYNC_ABI);
    const badDebtIface = new ethers.Interface(VAULT_BAD_DEBT_SYNC_ABI);
    const copyIface = new ethers.Interface(COPY_REGISTRY_SYNC_ABI);
    const vaultCoreAddress = (process.env.VAULT_CORE_ADDRESS ?? process.env.DEPLOYED_VAULT_CORE ?? "").trim();
    const copyRegistryAddress = (process.env.COPY_REGISTRY_ADDRESS ?? process.env.DEPLOYED_COPY_REGISTRY ?? "").trim();
    const rebateTopic = ethers.id("RebateAccrued(address,uint256)");
    const badDebtTopic = ethers.id("BadDebtCovered(uint256,uint256,uint256)");
    // All five CopyRegistry events, matched in one getLogs call per range.
    const copyTopics = [
      "LeadTraderRegistered(uint256,address,uint16,string)",
      "LeadTraderUpdated(uint256,uint16,string)",
      "FollowedTrader(address,address,uint256,uint8)",
      "UnfollowedTrader(address,address)",
      "CopierConfigUpdated(address,address,uint256,uint8)",
    ].map((sig) => ethers.id(sig));

    // First-sync start height. Override with INDEXER_START_BLOCK on testnet to
    // skip millions of empty blocks (e.g. 255580000 when trading began ~255584k).
    let startBlock = Math.max(0, Number(process.env.INDEXER_START_BLOCK ?? "248000000") || 248000000);
    let resumedFromCursor = false;
    let reorgDepth = 0;
    const stateResult = await pool.query(`SELECT last_synced_block FROM indexer_state WHERE key = 'trading_core'`);
    if (stateResult.rows.length > 0) {
      // Reorg-aware resume: walk stored block hashes back to the common ancestor
      // instead of blindly rewinding a fixed window. On a healthy chain this
      // resumes exactly at last+1 (no wasted re-scan); on a reorg it rewinds
      // precisely to the orphan point. The (tx_hash, log_index) unique guard +
      // the purge below keep the re-ingest idempotent either way.
      const last = Number(stateResult.rows[0].last_synced_block);
      const resume = await findReorgSafeResume(pool, provider, last);
      startBlock = Math.max(0, resume.safeBlock + 1);
      reorgDepth = resume.reorgDepth;
      resumedFromCursor = true;
      if (reorgDepth > 0) {
        recordIndexerReorg(reorgDepth);
        console.warn(`[sync] reorg detected: ${reorgDepth} block(s) orphaned; rewinding to ${startBlock} (fallback=${resume.usedFallback})`);
      }
    }

    if (options?.fromBlock !== undefined) {
      // Explicit backfill request — honor it verbatim (no reorg rewind).
      startBlock = options.fromBlock;
      resumedFromCursor = false;
      reorgDepth = 0;
    }

    const latestBlock = await provider.getBlockNumber();
    if (startBlock > latestBlock) {
      setIndexerLag(0);
      return { success: true, message: "Already up to date", latestBlock, startBlock };
    }

    // Reorg safety: drop any previously-indexed events at/above the resume point
    // so logs from orphaned blocks are removed before the canonical chain is
    // re-ingested. With precise reorg detection this purge is usually a no-op
    // (startBlock = last+1, nothing indexed above it); it only deletes real rows
    // when a reorg actually rewound the cursor. The (tx_hash, log_index) unique
    // guard makes re-inserting still-canonical logs a no-op, so this is safe to
    // repeat every pulse. Orphaned checkpoints are dropped alongside the events.
    if (resumedFromCursor) {
      try {
        await pool.query(`DELETE FROM position_events WHERE block_number >= $1`, [startBlock]);
        await pool.query(`DELETE FROM block_checkpoints WHERE key = 'trading_core' AND block_number >= $1`, [startBlock]);
      } catch (e) {
        console.error("[sync] reorg-window purge failed:", e);
      }
    }

    const targetTopics = [
      "PositionOpened(uint256,address,address,bool,uint256,uint256,uint256)",
      "PositionClosed(uint256,address,int256,uint256,uint256)",
      "PositionLiquidated(uint256,address,uint256,uint256)"
    ].map(sig => ethers.id(sig));

    let totalSynced = 0;
    let rebatesSynced = 0;
    let badDebtSynced = 0;
    let copyEventsSynced = 0;
    let currentStart = startBlock;
    let finalTo = startBlock - 1;
    // Adaptive window: starts large, halves on RPC failure, grows back on
    // success. A single oversized/failing range can no longer wedge the loop.
    let chunk = MAX_CHUNK;
    const startTime = Date.now();
    // API lazy-sync keeps a short budget; the dedicated worker gets a much
    // larger window so each pulse can scan a meaningful range toward head.
    const TIMEOUT_MS = Math.max(
      1000,
      Number(
        process.env.INDEXER_PULSE_TIMEOUT_MS ??
          (/^(1|true|yes)$/i.test(process.env.INDEXER_WORKER ?? "") ? "120000" : "7500"),
      ) || 7500,
    );

    while (currentStart <= latestBlock) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.log(`[sync] Timeout reached after ${Date.now() - startTime}ms. Progress: ${finalTo}`);
        break;
      }

      const currentTo = Math.min(currentStart + chunk, latestBlock);
      let batchLogs: any[];
      let rebateLogs: any[];
      let badDebtLogs: any[];
      let copyLogs: any[];
      try {
        [batchLogs, rebateLogs, badDebtLogs, copyLogs] = await Promise.all([
          provider.getLogs({
            address: tradingCoreAddress,
            fromBlock: currentStart,
            toBlock: currentTo,
            topics: [targetTopics]
          }),
          // Referral rebates live on VaultCore; skip the scan entirely when unset.
          vaultCoreAddress
            ? provider.getLogs({
                address: vaultCoreAddress,
                fromBlock: currentStart,
                toBlock: currentTo,
                topics: [rebateTopic]
              }).catch((e: any) => {
                console.error("[sync] rebate getLogs failed:", e?.message ?? e);
                return [] as any[];
              })
            : Promise.resolve([] as any[]),
          // Insurance payouts (BadDebtCovered) also live on VaultCore.
          vaultCoreAddress
            ? provider.getLogs({
                address: vaultCoreAddress,
                fromBlock: currentStart,
                toBlock: currentTo,
                topics: [badDebtTopic]
              }).catch((e: any) => {
                console.error("[sync] bad-debt getLogs failed:", e?.message ?? e);
                return [] as any[];
              })
            : Promise.resolve([] as any[]),
          // Social copy-trading events live on CopyRegistry; skip when unset.
          copyRegistryAddress
            ? provider.getLogs({
                address: copyRegistryAddress,
                fromBlock: currentStart,
                toBlock: currentTo,
                topics: [copyTopics]
              }).catch((e: any) => {
                console.error("[sync] copy-registry getLogs failed:", e?.message ?? e);
                return [] as any[];
              })
            : Promise.resolve([] as any[]),
        ]);
      } catch (e: any) {
        // Range too large / RPC hiccup: shrink and retry the same start instead
        // of failing the whole pulse (the old fixed 50k window wedged here).
        if (chunk > MIN_CHUNK) {
          chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
          console.warn(`[sync] getLogs failed for [${currentStart}, ${currentTo}], shrinking chunk -> ${chunk}: ${e?.message ?? e}`);
          continue;
        }
        // Already at the floor — surface progress made so far and stop cleanly.
        console.error(`[sync] getLogs failed at min chunk [${currentStart}, ${currentTo}]: ${e?.message ?? e}`);
        break;
      }

      totalSynced += await processLogs(batchLogs, iface, pool, provider);
      rebatesSynced += await processRebateLogs(rebateLogs, rebateIface, pool, provider);
      badDebtSynced += await processBadDebtLogs(badDebtLogs, badDebtIface, pool, provider);
      copyEventsSynced += await processCopyRegistryLogs(copyLogs, copyIface, pool, provider);
      finalTo = currentTo;
      // Persist progress incrementally so a later timeout never loses this range.
      await persistCursor(pool, finalTo);
      // Checkpoint the canonical hash of the highest scanned block so the next
      // resume can detect a reorg precisely (best-effort: never abort ingest).
      try {
        const head = await getBlockHash(currentTo, provider);
        if (head) await persistBlockHash(pool, currentTo, head);
      } catch (e) {
        console.warn(`[sync] checkpoint persist failed for ${currentTo}:`, (e as any)?.message ?? e);
      }
      // Healthy chunk — grow back toward the cap for throughput.
      if (chunk < MAX_CHUNK) chunk = Math.min(MAX_CHUNK, chunk * 2);
      if (currentTo >= latestBlock) break;
      currentStart = currentTo + 1;
    }

    // Final cursor persist (covers the no-iteration edge and keeps last_synced_at fresh).
    await persistCursor(pool, finalTo);
    setIndexerLag(Math.max(0, latestBlock - finalTo));

    // Recompute lead-trader performance + follower counts from the freshly
    // indexed data. Best-effort: a stats failure must never fail the sync pulse
    // (the raw events are already persisted and can be re-aggregated next pulse).
    if (copyRegistryAddress) {
      try {
        await refreshCopyTradingStats(pool);
      } catch (e) {
        console.error("[sync] copy-trading stats refresh failed:", (e as any)?.message ?? e);
      }
    }

    const duration = Date.now() - startTime;
    return {
      success: true,
      eventsSynced: totalSynced,
      rebatesSynced,
      badDebtSynced,
      copyEventsSynced,
      scannedFrom: startBlock,
      scannedTo: finalTo,
      reorgDepth,
      latestBlock,
      durationMs: duration,
      isCaughtUp: finalTo >= latestBlock
    };
  } finally {
    await release().catch(() => { /* lock release best-effort */ });
  }
}

const blockTimeCache = new Map<number, number>();
async function getBlockTime(blockNumber: number, provider: ethers.Provider): Promise<number> {
  const cached = blockTimeCache.get(blockNumber);
  if (cached) return cached;
  try {
    const block = await provider.getBlock(blockNumber);
    const t = block?.timestamp ?? Math.floor(Date.now() / 1000);
    blockTimeCache.set(blockNumber, t);
    if (blockTimeCache.size > 2000) {
      const firstKey = blockTimeCache.keys().next().value;
      if (firstKey !== undefined) blockTimeCache.delete(firstKey);
    }
    return Number(t);
  } catch (err) {
    console.error(`Failed to fetch block time for ${blockNumber}:`, err);
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Canonical hash of a block, used to checkpoint scanned heights for reorg
 * detection. Returns null when the header isn't available so callers can skip
 * checkpointing rather than store a bogus hash.
 */
async function getBlockHash(blockNumber: number, provider: ethers.Provider): Promise<string | null> {
  try {
    const block = await provider.getBlock(blockNumber);
    return block?.hash ?? null;
  } catch (err) {
    console.warn(`[sync] failed to fetch block hash for ${blockNumber}:`, (err as any)?.message ?? err);
    return null;
  }
}

async function processLogs(logs: any[], iface: ethers.Interface, pool: pg.Pool, provider: ethers.Provider) {
  let inserted = 0;
  let lastBlock = -1;
  let lastTime = 0;

  // Within-pulse cache of resolved open events keyed by position id. A close
  // and its later liquidation (or a liquidation cascade) no longer each fire a
  // separate SELECT, which kept the close/liquidate resolution from serializing
  // hundreds of round-trips inside the tight serverless time budget.
  const openCache = new Map<string, { account: string; marketId: string }>();

  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;

      let account = log.address;
      let marketId = "0x";
      let sizeUsd = "0";

      // Typed columns decoded once from the event ABI at this single ingest
      // point (positional decode here is unavoidable, but it removes the
      // scattered (data::jsonb->>N) magic-index math from every read query).
      const a = parsed.args as unknown as any[];
      const positionId: string | null = a[0] != null ? a[0].toString() : null;
      let isLong: boolean | null = null;
      let sizeRaw: string | null = null;
      let leverageRaw: string | null = null;
      let entryPrice: string | null = null;
      let realizedPnl: string | null = null;
      let exitPrice: string | null = null;
      let feeRaw: string | null = null;

      // Optimize block time fetching within a batch
      let blockTime;
      if (log.blockNumber === lastBlock) {
        blockTime = lastTime;
      } else {
        blockTime = await getBlockTime(log.blockNumber, provider);
        lastBlock = log.blockNumber;
        lastTime = blockTime;
      }

      if (parsed.name === "PositionOpened") {
        account = String(a[1]).toLowerCase();
        marketId = String(a[2]).toLowerCase();
        isLong = Boolean(a[3]);
        sizeRaw = a[4] != null ? a[4].toString() : null;
        leverageRaw = a[5] != null ? a[5].toString() : null;
        entryPrice = a[6] != null ? a[6].toString() : null;
        sizeUsd = (Number(a[4]) / 1e18).toFixed(18);
        // Seed the resolution cache so a close/liquidate in the same pulse
        // doesn't need to hit the DB at all.
        openCache.set(String(a[0]), { account, marketId });
      } else if (parsed.name === "PositionClosed" || parsed.name === "PositionLiquidated") {
        const posId = String(a[0]);
        if (parsed.name === "PositionClosed") {
          account = String(a[1]).toLowerCase();
          realizedPnl = a[2] != null ? a[2].toString() : null;
          exitPrice = a[3] != null ? a[3].toString() : null;
          feeRaw = a[4] != null ? a[4].toString() : null;
        } else {
          // PositionLiquidated(positionId, liquidator, liquidationPrice, liquidationFee)
          exitPrice = a[2] != null ? a[2].toString() : null;
          feeRaw = a[3] != null ? a[3].toString() : null;
        }

        const cachedOpen = openCache.get(posId);
        if (cachedOpen) {
          marketId = cachedOpen.marketId || marketId;
          account = cachedOpen.account || account;
        } else {
          try {
            // Robust resolution: prefer the typed position_id column, then fall
            // back to the open event's stored fields.
            const openEvt = await pool.query(
              `SELECT account, market_id, data FROM position_events 
               WHERE event_type = 'PositionOpened' AND position_id = $1::numeric 
               ORDER BY id DESC LIMIT 1`,
              [posId]
            );
            if (openEvt.rows.length > 0) {
              const row = openEvt.rows[0];
              marketId = (row.market_id && row.market_id !== "0x")
                ? row.market_id.toLowerCase()
                : String(Array.isArray(row.data) ? row.data[2] : row.data?.market || "0x").toLowerCase();
              account = row.account ? row.account.toLowerCase() : account;
              openCache.set(posId, { account, marketId });
            }
          } catch { /* ignore */ }
        }
      }

      const eventData = JSON.stringify(parsed.args.map(arg => typeof arg === 'bigint' ? arg.toString() : arg));
      const logIndex = log.index ?? log.logIndex ?? 0;
      // ON CONFLICT DO NOTHING + the (tx_hash, log_index) unique guard makes
      // ingestion idempotent: overlapping re-scans (adaptive-chunk retries, the
      // reorg re-scan window, cron/lazy-sync overlap) can't double-count.
      await pool.query(
        `INSERT INTO position_events (account, market_id, size_usd, event_type, block_number, tx_hash, data, block_time, log_index, position_id, is_long, size_raw, leverage_raw, entry_price, realized_pnl, exit_price, fee) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (tx_hash, log_index) DO NOTHING`,
        [account, marketId, sizeUsd, parsed.name, log.blockNumber, log.transactionHash, eventData, blockTime, logIndex, positionId, isLong, sizeRaw, leverageRaw, entryPrice, realizedPnl, exitPrice, feeRaw]
      );
      inserted++;
    } catch (err) {
      console.error("Parse error", err);
    }
  }
  return inserted;
}

/**
 * Persist VaultCore `RebateAccrued(referrer, amount)` logs. Idempotent via the
 * `(tx_hash, log_index)` unique constraint so re-scans (overlapping ranges,
 * lazy-sync pulses) never double-count cumulative referral earnings.
 */
async function processRebateLogs(
  logs: any[],
  iface: ethers.Interface,
  pool: pg.Pool,
  provider: ethers.Provider,
) {
  let inserted = 0;
  let lastBlock = -1;
  let lastTime = 0;

  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;

      const referrer = String(parsed.args[0]).toLowerCase();
      const amount = (parsed.args[1] as bigint).toString();

      let blockTime;
      if (log.blockNumber === lastBlock) {
        blockTime = lastTime;
      } else {
        blockTime = await getBlockTime(log.blockNumber, provider);
        lastBlock = log.blockNumber;
        lastTime = blockTime;
      }

      const result = await pool.query(
        `INSERT INTO referral_rebates (referrer, amount, block_number, log_index, tx_hash, block_time)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tx_hash, log_index) DO NOTHING`,
        [referrer, amount, log.blockNumber, log.index ?? log.logIndex ?? 0, log.transactionHash, blockTime]
      );
      inserted += result.rowCount ?? 0;
    } catch (err) {
      console.error("Rebate parse error", err);
    }
  }
  return inserted;
}

/**
 * Persist VaultCore `BadDebtCovered(claimId, amount, positionId)` logs — the
 * actual insurance-fund payouts shown on the Insurance page. Idempotent via the
 * `(tx_hash, log_index)` unique constraint so overlapping re-scans never
 * double-count.
 */
async function processBadDebtLogs(
  logs: any[],
  iface: ethers.Interface,
  pool: pg.Pool,
  provider: ethers.Provider,
) {
  let inserted = 0;
  let lastBlock = -1;
  let lastTime = 0;

  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;

      const claimId = (parsed.args[0] as bigint).toString();
      const amount = (parsed.args[1] as bigint).toString();
      const positionId = (parsed.args[2] as bigint).toString();

      let blockTime;
      if (log.blockNumber === lastBlock) {
        blockTime = lastTime;
      } else {
        blockTime = await getBlockTime(log.blockNumber, provider);
        lastBlock = log.blockNumber;
        lastTime = blockTime;
      }

      const result = await pool.query(
        `INSERT INTO bad_debt_claims (claim_id, position_id, amount, block_number, log_index, tx_hash, block_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tx_hash, log_index) DO NOTHING`,
        [claimId, positionId, amount, log.blockNumber, log.index ?? log.logIndex ?? 0, log.transactionHash, blockTime]
      );
      inserted += result.rowCount ?? 0;
    } catch (err) {
      console.error("Bad-debt parse error", err);
    }
  }
  return inserted;
}

/**
 * Apply CopyRegistry social-trading events to the relational copy-trading
 * tables. Unlike the append-only event stores, these are *state* mutations
 * (register / follow / unfollow / reconfigure), so we upsert by natural key.
 * getLogs returns logs in ascending (block, logIndex) order and re-scans replay
 * that same order, so the final state converges correctly — the latest event
 * for a (copier, leadTrader) pair wins, matching on-chain truth.
 */
async function processCopyRegistryLogs(
  logs: any[],
  iface: ethers.Interface,
  pool: pg.Pool,
  provider: ethers.Provider,
) {
  let applied = 0;
  let lastBlock = -1;
  let lastTime = 0;

  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;

      let blockTime: number;
      if (log.blockNumber === lastBlock) {
        blockTime = lastTime;
      } else {
        blockTime = await getBlockTime(log.blockNumber, provider);
        lastBlock = log.blockNumber;
        lastTime = blockTime;
      }

      const a = parsed.args as unknown as any[];

      if (parsed.name === "LeadTraderRegistered") {
        const id = (a[0] as bigint).toString();
        const trader = String(a[1]).toLowerCase();
        const profitFeeBps = Number(a[2]);
        const metadataURI = String(a[3] ?? "");
        await pool.query(
          `INSERT INTO lead_traders (id, address, profit_fee_bps, metadata_uri, is_active, registered_at)
           VALUES ($1, $2, $3, $4, true, to_timestamp($5))
           ON CONFLICT (id) DO UPDATE SET
             address = EXCLUDED.address,
             profit_fee_bps = EXCLUDED.profit_fee_bps,
             metadata_uri = EXCLUDED.metadata_uri,
             is_active = true`,
          [id, trader, profitFeeBps, metadataURI, blockTime]
        );
        applied++;
      } else if (parsed.name === "LeadTraderUpdated") {
        const id = (a[0] as bigint).toString();
        const profitFeeBps = Number(a[1]);
        const metadataURI = String(a[2] ?? "");
        await pool.query(
          `UPDATE lead_traders SET profit_fee_bps = $2, metadata_uri = $3 WHERE id = $1`,
          [id, profitFeeBps, metadataURI]
        );
        applied++;
      } else if (parsed.name === "FollowedTrader") {
        const copier = String(a[0]).toLowerCase();
        const leadTrader = String(a[1]).toLowerCase();
        const maxAllocation = (a[2] as bigint).toString();
        const maxLeverage = Number(a[3]);
        await pool.query(
          `INSERT INTO copy_relationships
             (copier_address, lead_trader_address, max_allocation, max_leverage, is_active, started_at, updated_at)
           VALUES ($1, $2, $3, $4, true, to_timestamp($5), NOW())
           ON CONFLICT (copier_address, lead_trader_address) DO UPDATE SET
             max_allocation = EXCLUDED.max_allocation,
             max_leverage = EXCLUDED.max_leverage,
             is_active = true,
             started_at = EXCLUDED.started_at,
             updated_at = NOW()`,
          [copier, leadTrader, maxAllocation, maxLeverage, blockTime]
        );
        applied++;
      } else if (parsed.name === "CopierConfigUpdated") {
        const copier = String(a[0]).toLowerCase();
        const leadTrader = String(a[1]).toLowerCase();
        const maxAllocation = (a[2] as bigint).toString();
        const maxLeverage = Number(a[3]);
        await pool.query(
          `UPDATE copy_relationships
             SET max_allocation = $3, max_leverage = $4, updated_at = NOW()
           WHERE copier_address = $1 AND lead_trader_address = $2`,
          [copier, leadTrader, maxAllocation, maxLeverage]
        );
        applied++;
      } else if (parsed.name === "UnfollowedTrader") {
        const copier = String(a[0]).toLowerCase();
        const leadTrader = String(a[1]).toLowerCase();
        await pool.query(
          `UPDATE copy_relationships
             SET is_active = false, updated_at = NOW()
           WHERE copier_address = $1 AND lead_trader_address = $2`,
          [copier, leadTrader]
        );
        applied++;
      }
    } catch (err) {
      console.error("Copy-registry parse error", err);
    }
  }
  return applied;
}

/**
 * Derive lead-trader performance (lead_trader_stats) and follower counts from
 * the indexed data. PnL/ROI/win-rate come from each lead trader's OWN closed
 * and liquidated positions in position_events — the same source the leaderboard
 * uses — so the numbers are real on-chain results, not placeholders.
 *
 *   total_pnl  — SUM(realized PnL) in USD (realized_pnl is 1e18-scaled)
 *   roi        — total_pnl / total margin deployed on closed trades × 100
 *   win_rate   — share of closed/liquidated trades that ended in profit
 *   total_trades — count of closed + liquidated positions
 *
 * Liquidations count as a full loss of the position's margin (size/leverage),
 * mirroring fetchLeaderboard's treatment.
 */
async function refreshCopyTradingStats(pool: pg.Pool): Promise<void> {
  // Keep the denormalized follower count in step with live relationships.
  await pool.query(
    `UPDATE lead_traders lt SET active_followers = (
       SELECT COUNT(*) FROM copy_relationships cr
       WHERE lower(cr.lead_trader_address) = lower(lt.address) AND cr.is_active = true
     )`
  );

  // Recompute performance for every registered lead trader from their own
  // realized trading history. LEFT JOIN so a lead trader with no closed trades
  // still gets a zeroed stats row (the top-traders LEFT JOIN expects one).
  await pool.query(`
    WITH opened AS (
      SELECT DISTINCT ON (position_id)
        position_id,
        lower(account) AS addr,
        COALESCE(size_raw, 0) AS size_raw,
        COALESCE(leverage_raw, 0) AS leverage_raw
      FROM position_events
      WHERE event_type = 'PositionOpened' AND position_id IS NOT NULL
      ORDER BY position_id, id ASC
    ),
    realized AS (
      -- Closes: trader is the event account, PnL is the logged realized_pnl.
      SELECT lower(c.account) AS addr,
             c.position_id,
             COALESCE(c.realized_pnl, 0) AS pnl_raw
      FROM position_events c
      WHERE c.event_type = 'PositionClosed' AND c.position_id IS NOT NULL

      UNION ALL

      -- Liquidations: trader resolved via the matching open; PnL = -margin.
      SELECT o.addr,
             e.position_id,
             CASE WHEN o.leverage_raw > 0
                  THEN -(o.size_raw / (o.leverage_raw / POWER(10::numeric, 18)))
                  ELSE 0::numeric END AS pnl_raw
      FROM position_events e
      JOIN opened o ON o.position_id = e.position_id
      WHERE e.event_type = 'PositionLiquidated' AND e.position_id IS NOT NULL
    ),
    agg AS (
      SELECT r.addr,
             COUNT(*) AS total_trades,
             SUM(r.pnl_raw) / POWER(10::numeric, 18) AS total_pnl_usd,
             SUM(CASE WHEN r.pnl_raw > 0 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN o.leverage_raw > 0
                      THEN o.size_raw / o.leverage_raw
                      ELSE 0::numeric END) AS total_margin_usd
      FROM realized r
      LEFT JOIN opened o ON o.position_id = r.position_id
      GROUP BY r.addr
    )
    INSERT INTO lead_trader_stats (lead_trader_id, total_pnl, roi, win_rate, total_trades, updated_at)
    SELECT lt.id,
           COALESCE(agg.total_pnl_usd, 0),
           CASE WHEN COALESCE(agg.total_margin_usd, 0) > 0
                THEN (agg.total_pnl_usd / agg.total_margin_usd) * 100
                ELSE 0 END,
           CASE WHEN COALESCE(agg.total_trades, 0) > 0
                THEN (agg.wins::numeric / agg.total_trades) * 100
                ELSE 0 END,
           COALESCE(agg.total_trades, 0),
           NOW()
    FROM lead_traders lt
    LEFT JOIN agg ON agg.addr = lower(lt.address)
    ON CONFLICT (lead_trader_id) DO UPDATE SET
      total_pnl = EXCLUDED.total_pnl,
      roi = EXCLUDED.roi,
      win_rate = EXCLUDED.win_rate,
      total_trades = EXCLUDED.total_trades,
      updated_at = NOW()
  `);
}

/** Repair missing block_time for recent events */
async function runRepair(pool: pg.Pool, provider: ethers.Provider) {
  try {
    const missing = await pool.query(`
      SELECT id, block_number FROM position_events 
      WHERE block_time IS NULL 
      ORDER BY id DESC LIMIT 500
    `);
    if (missing.rows.length === 0) return;

    console.log(`[repair] Fixing ${missing.rows.length} events missing block_time...`);
    for (const row of missing.rows) {
      const t = await getBlockTime(row.block_number, provider);
      await pool.query(`UPDATE position_events SET block_time = $1 WHERE id = $2`, [t, row.id]);
    }
  } catch (err) {
    console.error("[repair] failure:", err);
  }
}

/** Triggered by API traffic when Crons are unavailable. */
export async function checkAndSync() {
  const pool = getPool();
  if (!pool) return;
  try {
    const res = await pool.query(`SELECT last_synced_at FROM indexer_state WHERE key = 'trading_core'`);
    const lastSync = res.rows[0]?.last_synced_at;
    const now = new Date();
    
    // If no sync yet or last sync > 30s ago
    if (!lastSync || (now.getTime() - new Date(lastSync).getTime() > 30 * 1000)) {
      console.log("[lazy-sync] Data is stale, starting catch-up pulse...");
      // Await the sync pulse so a short-lived invocation doesn't terminate before it makes progress
      const provider = getProvider();
      await runSync().catch(err => console.error("[lazy-sync] failure:", err));
      if (provider) await runRepair(pool, provider).catch(() => {});
    }
  } catch (err) {
    console.error("[lazy-sync] check failure:", err);
  }
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
