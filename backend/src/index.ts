import { config } from "./config.js";
import { app, logger } from "./app.js";
import { startWsServer } from "./wsServer.js";
import { runSync } from "./routes/sync.js";

export async function bootstrap() {
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
      : !process.env.VERCEL;

  if (enableWs) {
    startWsServer();
  } else {
    logger.info("WebSocket server disabled (ENABLE_WS=false or Vercel runtime); frontend should use polling mode.");
  }

  // Background indexing loop (auto-sync)
  // Only run if not on Vercel (Production uses Vercel Crons)
  if (!process.env.VERCEL) {
    const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes
    logger.info({ intervalMs: SYNC_INTERVAL }, "Starting background sync loop");
    const interval = setInterval(async () => {
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
    return { server, interval };
  }
  return { server };
}

export function handleBootstrapError(err: any) {
  logger.error({ err }, "Failed to bootstrap server");
}

// Auto-bootstrap if not in test environment
if (process.env.NODE_ENV !== "test") {
  bootstrap().catch(handleBootstrapError);
}
