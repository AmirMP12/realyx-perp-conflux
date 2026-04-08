import { Router, Request, Response } from "express";
import { config } from "../config.js";
import { fetchPythPrices } from "../services/pyth.js";
import { fetchProtocol } from "../services/indexer.js";
import { getActiveMarketAddresses } from "../services/activeMarkets.js";

const router = Router();

/** Basic liveness - always returns ok */
router.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/** Extended health - verifies RPC, subgraph, Pyth */
router.get("/detailed", async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
  const start = Date.now();

  try {
    const t0 = Date.now();
    await fetchProtocol();
    checks.indexer = { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    checks.indexer = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const t0 = Date.now();
    const prices = await fetchPythPrices();
    checks.pyth = { ok: true, latencyMs: Date.now() - t0 };
    (checks.pyth as Record<string, unknown>).pricesCount = Object.keys(prices || {}).length;
  } catch (e) {
    checks.pyth = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const t0 = Date.now();
    const active = await getActiveMarketAddresses();
    checks.rpc = { ok: true, latencyMs: Date.now() - t0 };
    (checks.rpc as Record<string, unknown>).activeMarkets = active?.size ?? null;
  } catch (e) {
    checks.rpc = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    ok: allOk,
    ts: new Date().toISOString(),
    latencyMs: Date.now() - start,
    checks,
    config: {
      indexerSet: Boolean(config.postgresUrl),
      rpcSet: Boolean(process.env.RPC_URL?.trim()),
      tradingCoreSet: Boolean((process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE)?.trim()),
    },
  });
});

export default router;
