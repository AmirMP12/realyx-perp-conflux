/**
 * Dedicated indexer worker.
 *
 * Decouples ingestion from serving: this process does nothing but poll the
 * chain and write events to the PRIMARY Postgres (`POSTGRES_URL`). The API
 * tier serves reads from the replica (`POSTGRES_READ_URL`) and never has to
 * run the sync loop in-band, so request latency is unaffected by a hot
 * re-index and a slow/blocked indexer can't wedge the API event loop.
 *
 * Run it as a separate service (Railway/Fly/Render/VPS or a sidecar container):
 *
 *     node dist/worker.js          # production
 *     npm run worker               # alias
 *     npm run worker:dev           # tsx watch
 *
 * Ingestion is serialized cluster-wide by the Postgres advisory lock inside
 * `runSync`, so running this worker alongside the API's legacy in-process loop
 * (or a second worker for HA) is safe — overlapping pulses no-op rather than
 * double-write. For a clean split set `DISABLE_INBAND_SYNC=true` on the API.
 */

import { runSync } from "./routes/sync.js";
import { startReconciliationLoop } from "./services/reconciliation.js";
import { startMetricsServer } from "./metricsServer.js";
import type { Server } from "http";

const SYNC_INTERVAL_MS = Math.max(
  2_000,
  Number(process.env.INDEXER_INTERVAL_MS ?? "") || 5_000,
);

let stopping = false;
let stopReconcile: (() => void) | undefined;
let metricsServer: Server | undefined;

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown) {
  const line = `[indexer-worker] ${msg}`;
  if (level === "error") console.error(line, extra ?? "");
  else if (level === "warn") console.warn(line, extra ?? "");
  else console.log(line, extra ?? "");
}

async function pulse(): Promise<void> {
  try {
    const result = await runSync();
    if (result?.skipped) {
      log("info", "pulse skipped (another sync in progress)");
      return;
    }
    log(
      "info",
      `pulse ok: events=${result?.eventsSynced ?? 0} rebates=${result?.rebatesSynced ?? 0} ` +
        `scannedTo=${result?.scannedTo} reorgDepth=${result?.reorgDepth ?? 0} ` +
        `lag=${result?.latestBlock != null && result?.scannedTo != null ? result.latestBlock - result.scannedTo : "?"} ` +
        `caughtUp=${result?.isCaughtUp ?? false}`,
    );
  } catch (err) {
    log("error", "pulse failed:", err);
  }
}

async function loop(): Promise<void> {
  if (!process.env.POSTGRES_URL) {
    log("error", "POSTGRES_URL is not set — the indexer worker has nothing to write to. Exiting.");
    process.exit(1);
  }
  const tradingCore = (process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE ?? "").trim();
  if (!tradingCore) {
    log("error", "TRADING_CORE_ADDRESS / DEPLOYED_TRADING_CORE is not set. Exiting.");
    process.exit(1);
  }

  log("info", `starting; interval=${SYNC_INTERVAL_MS}ms tradingCore=${tradingCore}`);

  // Expose the worker's Prometheus registry (indexer lag, reorgs, reconciliation
  // drift) on METRICS_PORT. Without this the realyx-indexer / data-quality alert
  // groups would have no target to scrape, since the worker has no API server.
  if (process.env.NODE_ENV !== "test") {
    metricsServer = startMetricsServer();
  }

  // The worker is the natural home for reconciliation when the API runs in
  // reader-only mode (DISABLE_INBAND_SYNC=true). Publishes drift metrics on the
  // same process that owns ingestion. Disable with DISABLE_RECONCILIATION=true.
  if (!/^(1|true|yes)$/i.test(process.env.DISABLE_RECONCILIATION ?? "")) {
    stopReconcile = startReconciliationLoop();
    log("info", "reconciliation loop started");
  }

  // Sequential loop (not setInterval) so a slow pulse can't overlap itself; the
  // next pulse only starts after the previous one settles plus the interval.
  while (!stopping) {
    const started = Date.now();
    await pulse();
    const elapsed = Date.now() - started;
    const wait = Math.max(0, SYNC_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
  }
  stopReconcile?.();
  metricsServer?.close();
  log("info", "loop stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the process alive solely for the sleep timer during shutdown.
    if (typeof t.unref === "function") t.unref();
  });
}

function registerShutdown(): void {
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("info", `received ${signal}, shutting down…`);
    // Give an in-flight pulse a moment to settle, then force-exit.
    setTimeout(() => process.exit(0), 8_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Auto-start unless imported by a test.
if (process.env.NODE_ENV !== "test") {
  registerShutdown();
  loop().catch((err) => {
    log("error", "fatal worker error:", err);
    process.exit(1);
  });
}

export { pulse, loop, sleep, registerShutdown };
