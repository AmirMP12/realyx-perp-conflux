import { config } from "./config.js";
import { app, logger } from "./app.js";
import { startWsServer } from "./wsServer.js";

app.listen(config.port, () => {
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
