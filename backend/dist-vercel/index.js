import { config } from "./config.js";
import { app, logger } from "./app.js";
import { startWsServer } from "./wsServer.js";
import { startMetricsServer } from "./metricsServer.js";
import { runSync } from "./routes/sync.js";
export async function bootstrap() {
    const server = app.listen(config.port, () => {
        const rpcSet = Boolean(process.env.RPC_URL?.trim());
        const tradingCoreSet = Boolean((process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE)?.trim());
        logger.info({ port: config.port, activeMarketsFilter: rpcSet && tradingCoreSet }, "Backend listening");
        if (!rpcSet || !tradingCoreSet) {
            logger.warn("RPC_URL or TRADING_CORE_ADDRESS not set — /api/markets will return all fallback markets (no on-chain filter)");
        }
    });
    const enableWs = process.env.ENABLE_WS != null
        ? /^(1|true|yes)$/i.test(process.env.ENABLE_WS)
        : !process.env.VERCEL;
    let stopWs;
    if (enableWs) {
        stopWs = startWsServer();
    }
    else {
        logger.info("WebSocket server disabled (ENABLE_WS=false or Vercel runtime); frontend should use polling mode.");
    }
    // Prometheus metrics server (separate internal port). Disabled on Vercel and
    // in tests to avoid binding a second port.
    let metricsServer;
    if (!process.env.VERCEL && process.env.NODE_ENV !== "test") {
        metricsServer = startMetricsServer();
    }
    // Background indexing loop (auto-sync)
    // Only run if not on Vercel (Production uses Vercel Crons)
    let interval;
    if (!process.env.VERCEL) {
        const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes
        logger.info({ intervalMs: SYNC_INTERVAL }, "Starting background sync loop");
        interval = setInterval(async () => {
            try {
                logger.debug("Starting background auto-sync...");
                const result = await runSync();
                logger.info({ eventsSynced: result.eventsSynced, scannedTo: result.scannedTo }, "Background sync completed");
            }
            catch (err) {
                logger.error({ err }, "Background sync failed");
            }
        }, SYNC_INTERVAL);
    }
    // Graceful shutdown for container/orchestrator rolling deploys.
    if (process.env.NODE_ENV !== "test") {
        registerShutdown({ server, metricsServer, interval, stopWs });
    }
    return interval ? { server, interval, metricsServer } : { server, metricsServer };
}
export function registerShutdown(handles) {
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.info({ signal }, "Shutting down gracefully");
        if (handles.interval)
            clearInterval(handles.interval);
        try {
            handles.stopWs?.();
        }
        catch {
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
export function handleBootstrapError(err) {
    logger.error({ err }, "Failed to bootstrap server");
}
// Auto-bootstrap if not in test environment
if (process.env.NODE_ENV !== "test") {
    bootstrap().catch(handleBootstrapError);
}
