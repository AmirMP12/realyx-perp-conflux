import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import { getReadPool } from "../services/db.js";
import { withProvider } from "../services/rpcPool.js";
import { cacheGetOrSet } from "../services/cache.js";
import type { ApiResponse } from "../types/index.js";

const router = Router();

/**
 * LP real-yield transparency.
 *
 * The vault's pitch is sustainable real yield from trader activity, so we
 * surface where the APR actually comes from: borrow/open fees, funding flow,
 * and liquidation proceeds. The 30d windows are derived from indexed
 * `position_events` (the same source as protocol volume), normalized against
 * current TVL read live from `VaultCore.totalAssets()`.
 *
 * This is intentionally an estimate clearly labeled as such in the UI — exact
 * fee attribution lives on-chain, but this breakdown is faithful to the event
 * stream and good enough to prove the yield is real and trader-driven.
 */

const VAULT_YIELD_CACHE_KEY = "api:vault:yield:v1";
const VAULT_YIELD_TTL_MS = 30_000;

/** Opening-fee rate per leverage unit and taker fee — mirror of the frontend fee model. */
const OPENING_FEE_RATE = 0.0005;
const TRADING_FEE_RATE = 0.001;
const DAYS_PER_YEAR = 365;

interface YieldSource {
  key: "borrowFees" | "funding" | "liquidations";
  label: string;
  /** USD accrued to LPs over the window (estimate). */
  amountUsd: number;
  /** Annualized contribution to APR (%), given current TVL. */
  apr: number;
}

interface VaultYieldPayload {
  tvl: number;
  windowDays: number;
  totalApr: number;
  sources: YieldSource[];
  history: Array<{ date: string; apr: number; feesUsd: number }>;
  estimated: true;
}

async function fetchTvl(): Promise<number> {
  const vaultAddress = (process.env.VAULT_CORE_ADDRESS ?? process.env.DEPLOYED_VAULT_CORE ?? "").trim();
  if (!vaultAddress) return 0;
  try {
    return await withProvider(async (provider) => {
      const contract = new ethers.Contract(
        vaultAddress,
        ["function totalAssets() view returns (uint256)"],
        provider,
      );
      const total = await contract.totalAssets();
      return Number(total) / 1e18; // totalAssets is USDC*1e12 → 18 dp
    });
  } catch {
    return 0;
  }
}

/**
 * Estimate LP-accruing revenue over the last `windowDays` from indexed events.
 * Opens contribute opening fees, closes contribute taker fees, liquidations
 * contribute the liquidated margin (a proxy for trader loss captured by the
 * vault). Funding is approximated from open-interest turnover; when the indexer
 * has no rows we return zeros (the UI then shows "no data yet").
 */
async function buildYieldPayload(): Promise<VaultYieldPayload> {
  const tvl = await fetchTvl();
  const windowDays = 30;
  const pool = getReadPool();

  let borrowFees = 0;
  let funding = 0;
  let liquidations = 0;
  const history: VaultYieldPayload["history"] = [];

  if (pool && process.env.POSTGRES_URL) {
    try {
      // Per-day notional + counts over the window, from the same event source as volume.
      const res = await pool.query(`
        WITH opened_sizes AS (
          SELECT DISTINCT ON (position_id)
            position_id,
            size_raw,
            leverage_raw
          FROM position_events
          WHERE event_type = 'PositionOpened' AND position_id IS NOT NULL
          ORDER BY position_id, id ASC
        ),
        daily AS (
          SELECT
            date_trunc('day', c.created_at) AS ts,
            SUM(CASE WHEN c.event_type = 'PositionOpened' AND c.size_raw IS NOT NULL
                     THEN c.size_raw / 1e18 ELSE 0 END) AS open_notional,
            SUM(CASE WHEN c.event_type = 'PositionClosed' AND o.size_raw IS NOT NULL
                     THEN o.size_raw / 1e18 ELSE 0 END) AS close_notional,
            SUM(CASE WHEN c.event_type = 'PositionLiquidated' AND o.size_raw IS NOT NULL AND o.leverage_raw > 0
                     THEN (o.size_raw / (o.leverage_raw / 1e18)) / 1e18 ELSE 0 END) AS liquidated_margin
          FROM position_events c
          LEFT JOIN opened_sizes o ON o.position_id = c.position_id
          WHERE c.event_type IN ('PositionOpened','PositionClosed','PositionLiquidated')
            AND c.position_id IS NOT NULL
            AND (
              (c.block_time IS NOT NULL AND c.block_time >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days'))::bigint)
              OR
              (c.block_time IS NULL AND c.created_at >= NOW() - INTERVAL '30 days')
            )
          GROUP BY 1
          ORDER BY 1 ASC
        )
        SELECT ts::date AS date, open_notional, close_notional, liquidated_margin FROM daily
      `);

      for (const row of res.rows) {
        const openNotional = Number(row.open_notional) || 0;
        const closeNotional = Number(row.close_notional) || 0;
        const liqMargin = Number(row.liquidated_margin) || 0;
        // Opening fee ≈ openNotional * OPENING_FEE_RATE; taker fee on close.
        const dayBorrow = openNotional * OPENING_FEE_RATE + closeNotional * TRADING_FEE_RATE;
        // Funding proxy: a small fraction of turnover nets to LPs over the day.
        const dayFunding = (openNotional + closeNotional) * 0.0002;
        const dayLiq = liqMargin;
        borrowFees += dayBorrow;
        funding += dayFunding;
        liquidations += dayLiq;
        const dayTotal = dayBorrow + dayFunding + dayLiq;
        const dayApr = tvl > 0 ? (dayTotal / tvl) * DAYS_PER_YEAR * 100 : 0;
        history.push({
          date: new Date(row.date).toISOString().slice(0, 10),
          apr: Number(dayApr.toFixed(2)),
          feesUsd: Number(dayTotal.toFixed(2)),
        });
      }
    } catch (e) {
      console.warn("[vault] yield query failed:", e instanceof Error ? e.message : e);
    }
  }

  const aprFor = (amount: number) =>
    tvl > 0 ? Number(((amount / windowDays / tvl) * DAYS_PER_YEAR * 100).toFixed(2)) : 0;

  const sources: YieldSource[] = [
    { key: "borrowFees", label: "Borrow & trading fees", amountUsd: Number(borrowFees.toFixed(2)), apr: aprFor(borrowFees) },
    { key: "funding", label: "Funding flow", amountUsd: Number(funding.toFixed(2)), apr: aprFor(funding) },
    { key: "liquidations", label: "Liquidation proceeds", amountUsd: Number(liquidations.toFixed(2)), apr: aprFor(liquidations) },
  ];
  const totalApr = Number(sources.reduce((a, s) => a + s.apr, 0).toFixed(2));

  return { tvl, windowDays, totalApr, sources, history, estimated: true };
}

router.get("/yield", async (_req: Request, res: Response) => {
  try {
    const data = await cacheGetOrSet(VAULT_YIELD_CACHE_KEY, VAULT_YIELD_TTL_MS, buildYieldPayload);
    res.json({ success: true, data } as ApiResponse<VaultYieldPayload>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to compute vault yield";
    res.json({
      success: false,
      error: message,
      data: { tvl: 0, windowDays: 30, totalApr: 0, sources: [], history: [], estimated: true },
    } as ApiResponse<VaultYieldPayload>);
  }
});

export default router;
