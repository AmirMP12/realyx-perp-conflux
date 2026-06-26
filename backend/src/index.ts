import type { Server } from "http";
import { config } from "./config.js";
import { app, logger } from "./app.js";
import { startWsServer } from "./wsServer.js";
import { startMetricsServer } from "./metricsServer.js";
import { runSync } from "./routes/sync.js";
import { startReconciliationLoop } from "./services/reconciliation.js";
import { initCacheBackend } from "./services/cache.js";

export async function bootstrap() {
  // Wire the shared cache backend (Redis when REDIS_URL is set, else in-memory).
  await initCacheBackend();

  const server = app.listen(config.port, () => {
    const rpcSet = Boolean(process.env.RPC_URL?.trim());
    const tradingCoreSet = Boolean((process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE)?.trim());
    logger.info(
      { port: config.port, activeMarketsFilter: rpcSet && tradingCoreSet },
      "Backend listening"
    );
    if (!rpcSet || !tradingCoreSet) {
      logger.warn("RPC_URL or TRADING_CORE_ADDRESS not set — /api/markets will return all fallback markets (no on-chain filter)");
    }
  });

  const enableWs =
    process.env.ENABLE_WS != null
      ? /^(1|true|yes)$/i.test(process.env.ENABLE_WS)
      : true;

  let stopWs: (() => void) | undefined;
  if (enableWs) {
    stopWs = startWsServer();
  } else {
    logger.info("WebSocket server disabled (ENABLE_WS=false); frontend should use polling mode.");
  }

  // Prometheus metrics server (separate internal port). Disabled in tests to
  // avoid binding a second port.
  let metricsServer: Server | undefined;
  if (process.env.NODE_ENV !== "test") {
    metricsServer = startMetricsServer();
  }

  // Background indexing loop (auto-sync). When a dedicated indexer worker
  // handles ingestion (see worker.ts), set DISABLE_INBAND_SYNC=true so the API
  // tier is purely a reader and request latency is never affected by a hot
  // re-index. The advisory lock in runSync makes overlap safe either way, this
  // just avoids redundant work.
  let interval: ReturnType<typeof setInterval> | undefined;
  const inbandSyncDisabled = /^(1|true|yes)$/i.test(process.env.DISABLE_INBAND_SYNC ?? "");
  if (!inbandSyncDisabled) {
    const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes
    logger.info({ intervalMs: SYNC_INTERVAL }, "Starting background sync loop");
    interval = setInterval(async () => {
      try {
        logger.debug("Starting background auto-sync...");
        const result = await runSync();
        logger.info(
          { eventsSynced: result.eventsSynced, scannedTo: result.scannedTo },
          "Background sync completed"
        );
      } catch (err) {
        logger.error({ err }, "Background sync failed");
      }
    }, SYNC_INTERVAL);
  } else if (inbandSyncDisabled) {
    logger.info("In-band sync disabled (DISABLE_INBAND_SYNC=true); expecting a dedicated indexer worker.");
  }

  // Periodic data-quality reconciliation: compare indexed aggregates (OI) and
  // TVL against authoritative on-chain reads and publish drift to Prometheus.
  // Long-lived process only (not serverless).
  let stopReconcile: (() => void) | undefined;
  const reconcileDisabled = /^(1|true|yes)$/i.test(process.env.DISABLE_RECONCILIATION ?? "");
  if (!reconcileDisabled) {
    stopReconcile = startReconciliationLoop();
    logger.info("Started reconciliation loop");
  }

  // Graceful shutdown for container/orchestrator rolling deploys.
  if (process.env.NODE_ENV !== "test") {
    registerShutdown({ server, metricsServer, interval, stopWs, stopReconcile });
  }

  return interval ? { server, interval, metricsServer } : { server, metricsServer };
}

interface ShutdownHandles {
  server: Server;
  metricsServer?: Server;
  interval?: ReturnType<typeof setInterval>;
  stopWs?: () => void;
  stopReconcile?: () => void;
}

export function registerShutdown(handles: ShutdownHandles) {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully");

    if (handles.interval) clearInterval(handles.interval);
    try {
      handles.stopWs?.();
    } catch {
      /* ignore */
    }
    try {
      handles.stopReconcile?.();
    } catch {
      /* ignore */
    }
    handles.metricsServer?.close();
    handles.server.close((err) => {
      if (err) {
        logger.error({ err }, "Error during server close");
        process.exit(1);
      }
      logger.info("Shutdown complete");
      process.exit(0);
    });

    // Failsafe: force-exit if connections don't drain in time.
    setTimeout(() => {
      logger.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export function handleBootstrapError(err: any) {
  logger.error({ err }, "Failed to bootstrap server");
}

// Auto-bootstrap if not in test environment
if (process.env.NODE_ENV !== "test") {
  bootstrap().catch(handleBootstrapError);
}
