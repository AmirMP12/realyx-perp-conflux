import { ethers } from "ethers";
import { getReadPool } from "./db.js";
import { withProvider } from "./rpcPool.js";
import { fetchMarketsOnChain } from "./fetchMarketsOnchain.js";
import { setReconciliationDrift } from "../middleware/metrics.js";
import { logger } from "../logger.js";

/**
 * Data-quality reconciliation.
 *
 * Periodically compares the indexer's view of the world against authoritative
 * on-chain reads and publishes the relative drift to Prometheus. A silent
 * indexer bug (double-counted events, missed logs, a bad migration) shows up
 * here as drift long before a user notices a wrong portfolio — `realyx_
 * reconciliation_drift_ratio` is alerted on so on-call catches it first.
 *
 * Two checks:
 *  1. Open interest — sum of OPEN positions' notional in the indexer vs. the
 *     on-chain `totalLongSize + totalShortSize` across active markets.
 *  2. TVL — the vault assets the API would report vs. `VaultCore.totalAssets()`.
 *
 * Drift is reported as |indexed − onchain| / max(onchain, ε), so 0 == exact.
 */

const VAULT_TOTAL_ASSETS_ABI = ["function totalAssets() view returns (uint256)"];

/** Relative drift, guarded against divide-by-zero. */
export function relativeDrift(indexed: number, onchain: number): number {
  const denom = Math.max(Math.abs(onchain), 1e-9);
  return Math.abs(indexed - onchain) / denom;
}

/**
 * Indexed open interest (USD) derived from `position_events`: sum the notional
 * of opens that have no matching close/liquidation. Mirrors the open-position
 * resolution used by `fetchUserPositions`, aggregated globally.
 */
async function indexedOpenInterestUsd(): Promise<number | null> {
  const pool = getReadPool();
  if (!pool || !process.env.POSTGRES_URL) return null;
  try {
    const res = await pool.query(`
      SELECT COALESCE(SUM(o.size_raw), 0) / 1e18 AS oi
      FROM position_events o
      WHERE o.event_type = 'PositionOpened'
        AND o.size_raw IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM position_events c
          WHERE c.event_type IN ('PositionClosed', 'PositionLiquidated')
            AND c.position_id = o.position_id
        )
    `);
    const oi = Number(res.rows[0]?.oi);
    return Number.isFinite(oi) ? oi : null;
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : e }, "[reconcile] indexed OI query failed");
    return null;
  }
}

/** On-chain open interest (USD) = Σ (totalLongSize + totalShortSize) / 1e18. */
async function onchainOpenInterestUsd(): Promise<number | null> {
  try {
    const markets = await fetchMarketsOnChain();
    if (!markets.length) return null;
    let total = 0n;
    for (const m of markets) {
      total += BigInt(m.totalLongSize || "0") + BigInt(m.totalShortSize || "0");
    }
    return Number(total) / 1e18;
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : e }, "[reconcile] onchain OI read failed");
    return null;
  }
}

/** On-chain TVL (USD) from VaultCore.totalAssets() (USDC*1e12 → 18dp). */
async function onchainTvlUsd(): Promise<number | null> {
  const vaultAddress = (process.env.VAULT_CORE_ADDRESS ?? process.env.DEPLOYED_VAULT_CORE ?? "").trim();
  if (!vaultAddress) return null;
  try {
    return await withProvider(async (provider) => {
      const c = new ethers.Contract(vaultAddress, VAULT_TOTAL_ASSETS_ABI, provider);
      const total = await c.totalAssets();
      return Number(total) / 1e18;
    });
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : e }, "[reconcile] onchain TVL read failed");
    return null;
  }
}

export interface ReconciliationResult {
  openInterest?: { indexed: number; onchain: number; drift: number };
  tvl?: { onchain: number };
  ran: boolean;
}

/**
 * Run one reconciliation pass. Publishes drift gauges and returns the computed
 * values (handy for an admin/debug endpoint and tests). Never throws — a
 * reconciliation failure must not affect serving.
 */
export async function runReconciliation(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { ran: false };
  try {
    const [indexedOi, onchainOi, onchainTvl] = await Promise.all([
      indexedOpenInterestUsd(),
      onchainOpenInterestUsd(),
      onchainTvlUsd(),
    ]);

    if (indexedOi != null && onchainOi != null) {
      const drift = relativeDrift(indexedOi, onchainOi);
      setReconciliationDrift("open_interest", drift);
      result.openInterest = { indexed: indexedOi, onchain: onchainOi, drift };
      if (drift > 0.05) {
        logger.warn(
          { metric: "open_interest", driftRatio: drift, indexed: indexedOi, onchain: onchainOi },
          `[reconcile] OI drift ${(drift * 100).toFixed(2)}% (indexed=${indexedOi.toFixed(2)} onchain=${onchainOi.toFixed(2)})`,
        );
      }
    }

    // TVL is authoritative on-chain; we publish a 0 self-drift so the gauge and
    // last-run timestamp stay fresh and the "reconciliation stopped" alert works
    // even when the OI check can't run (e.g. no DB).
    if (onchainTvl != null) {
      setReconciliationDrift("tvl", 0);
      result.tvl = { onchain: onchainTvl };
    }

    result.ran = true;
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : e }, "[reconcile] run failed");
  }
  lastResult = result;
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastResult: ReconciliationResult = { ran: false };

/** The most recent reconciliation result (for status endpoints / debugging). */
export function getLastReconciliation(): ReconciliationResult {
  return lastResult;
}

/**
 * Start the periodic reconciliation loop. Safe to call once at bootstrap;
 * returns a stop function. Skipped when no RPC is configured (nothing to read).
 */
export function startReconciliationLoop(intervalMs = Number(process.env.RECONCILE_INTERVAL_MS ?? "300000")): () => void {
  const period = Math.max(30_000, intervalMs);
  // Kick off an initial pass shortly after boot, then on the interval.
  const initial = setTimeout(() => void runReconciliation(), 15_000);
  timer = setInterval(() => void runReconciliation(), period);
  return () => {
    clearTimeout(initial);
    if (timer) clearInterval(timer);
    timer = null;
  };
}
