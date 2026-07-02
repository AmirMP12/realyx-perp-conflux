import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import { fetchPythPrices } from "../services/pyth.js";
import { getActiveMarketAddresses } from "../services/activeMarkets.js";
import { getPoolHealth } from "../services/rpcPool.js";
import { fetchProtocol } from "../services/indexer.js";
import { withProvider } from "../services/rpcPool.js";
import { getLastReconciliation } from "../services/reconciliation.js";
import { cacheGetOrSet } from "../services/cache.js";
import type { ApiResponse } from "../types/index.js";

const router = Router();

/** Process start time for uptime reporting. */
const PROCESS_STARTED_AT = Date.now();

const STATUS_CACHE_KEY = "api:status:v1";
const STATUS_CACHE_TTL_MS = 15_000;

type Health = "operational" | "degraded" | "down";

interface Component {
  key: string;
  label: string;
  status: Health;
  detail?: string;
  latencyMs?: number;
}

interface StatusPayload {
  status: Health;
  uptimeSeconds: number;
  ts: string;
  components: Component[];
  vault: {
    /** TVL (LP assets) in USD. */
    tvl: number;
    /** Insurance fund balance in USD. */
    insuranceFund: number;
    /** Insurance health ratio as a percentage (>= 100 is healthy). */
    insuranceHealthPct: number;
    /** Available (unborrowed) liquidity in USD. */
    availableLiquidity: number;
    /**
     * Solvency ratio: (LP assets + insurance) / borrowed. > 1 means fully
     * backed. Infinity (reported as null) when nothing is borrowed.
     */
    solvencyRatio: number | null;
    insuranceHealthy: boolean;
  };
}

const VAULT_VIEW_ABI = [
  "function totalAssets() view returns (uint256)",
  "function insuranceAssets() view returns (uint256)",
  "function getInsuranceHealthRatio() view returns (uint256)",
  "function isInsuranceHealthy() view returns (bool)",
  "function getAvailableLiquidity() view returns (uint256)",
] as const;

async function readVault() {
  const vaultAddress = (process.env.VAULT_CORE_ADDRESS ?? process.env.DEPLOYED_VAULT_CORE ?? "").trim();
  if (!vaultAddress) {
    return { tvl: 0, insuranceFund: 0, insuranceHealthPct: 0, availableLiquidity: 0, solvencyRatio: null, insuranceHealthy: false };
  }
  return withProvider(async (provider) => {
    const c = new ethers.Contract(vaultAddress, VAULT_VIEW_ABI, provider);
    const [totalAssets, insurance, healthRatio, healthy, avail] = await Promise.all([
      c.totalAssets().catch(() => 0n),
      c.insuranceAssets().catch(() => 0n),
      c.getInsuranceHealthRatio().catch(() => 0n),
      c.isInsuranceHealthy().catch(() => false),
      c.getAvailableLiquidity().catch(() => 0n),
    ]);
    const tvl = Number(totalAssets) / 1e18;
    // insuranceAssets / availableLiquidity are in the collateral's native decimals (6).
    const insuranceFund = Number(insurance) / 1e6;
    const availableLiquidity = Number(avail) / 1e6;
    const insuranceHealthPct = Number(healthRatio) / 1e18 * 100;
    const borrowed = Math.max(0, tvl - availableLiquidity);
    const solvencyRatio = borrowed > 0 ? Number(((tvl + insuranceFund) / borrowed).toFixed(4)) : null;
    return {
      tvl,
      insuranceFund,
      insuranceHealthPct: Number(insuranceHealthPct.toFixed(2)),
      availableLiquidity,
      solvencyRatio,
      insuranceHealthy: Boolean(healthy),
    };
  });
}

async function buildStatusPayload(): Promise<StatusPayload> {
  const components: Component[] = [];

  // Oracle (Pyth)
  try {
    const t0 = Date.now();
    const prices = await fetchPythPrices();
    const count = Object.keys(prices || {}).length;
    components.push({
      key: "oracle",
      label: "Pyth oracle",
      status: count > 0 ? "operational" : "degraded",
      detail: `${count} feeds`,
      latencyMs: Date.now() - t0,
    });
  } catch (e) {
    components.push({ key: "oracle", label: "Pyth oracle", status: "down", detail: e instanceof Error ? e.message : "error" });
  }

  // RPC pool
  try {
    const t0 = Date.now();
    const active = await getActiveMarketAddresses();
    const pool = getPoolHealth();
    const healthy = pool.filter((p) => !p.cooling).length;
    const status: Health = healthy === 0 ? "down" : healthy < pool.length ? "degraded" : "operational";
    components.push({
      key: "rpc",
      label: "Conflux RPC",
      status,
      detail: `${healthy}/${pool.length || 1} endpoints · ${active?.size ?? 0} markets`,
      latencyMs: Date.now() - t0,
    });
  } catch (e) {
    components.push({ key: "rpc", label: "Conflux RPC", status: "down", detail: e instanceof Error ? e.message : "error" });
  }

  // Indexer
  try {
    const t0 = Date.now();
    const protocol = await fetchProtocol();
    const indexedTrades = protocol ? Number(protocol.totalTrades) || 0 : 0;
    const indexedVolume = protocol ? Number(protocol.totalVolumeUsd) || 0 : 0;
    const indexerStatus: Health =
      !protocol
        ? "degraded"
        : indexedTrades === 0 && indexedVolume === 0
          ? "degraded"
          : "operational";
    components.push({
      key: "indexer",
      label: "Indexer",
      status: indexerStatus,
      detail:
        protocol
          ? `${indexedTrades} trades · $${indexedVolume.toFixed(0)} vol`
          : "no database",
      latencyMs: Date.now() - t0,
    });
  } catch (e) {
    components.push({ key: "indexer", label: "Indexer", status: "degraded", detail: e instanceof Error ? e.message : "error" });
  }

  // Vault solvency
  let vault: StatusPayload["vault"];
  try {
    vault = await readVault();
    components.push({
      key: "vault",
      label: "Vault solvency",
      status: vault.insuranceHealthy || vault.solvencyRatio == null || vault.solvencyRatio >= 1 ? "operational" : "degraded",
      detail: vault.solvencyRatio == null ? "fully backed" : `${vault.solvencyRatio.toFixed(2)}x backed`,
    });
  } catch (e) {
    vault = { tvl: 0, insuranceFund: 0, insuranceHealthPct: 0, availableLiquidity: 0, solvencyRatio: null, insuranceHealthy: false };
    components.push({ key: "vault", label: "Vault solvency", status: "degraded", detail: e instanceof Error ? e.message : "error" });
  }

  // Data quality (reconciliation drift between indexed aggregates and on-chain).
  const recon = getLastReconciliation();
  if (recon.ran && recon.openInterest) {
    const drift = recon.openInterest.drift;
    components.push({
      key: "data_quality",
      label: "Data quality",
      status: drift > 0.15 ? "down" : drift > 0.05 ? "degraded" : "operational",
      detail: `OI drift ${(drift * 100).toFixed(2)}%`,
    });
  }

  // Overall: worst of components.
  const worst: Health = components.some((c) => c.status === "down")
    ? "down"
    : components.some((c) => c.status === "degraded")
      ? "degraded"
      : "operational";

  return {
    status: worst,
    uptimeSeconds: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
    ts: new Date().toISOString(),
    components,
    vault,
  };
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await cacheGetOrSet(STATUS_CACHE_KEY, STATUS_CACHE_TTL_MS, buildStatusPayload);
    res.json({ success: true, data } as ApiResponse<StatusPayload>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build status";
    res.status(503).json({ success: false, error: message } as ApiResponse<never>);
  }
});

export default router;
