"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_js_1 = require("./config.js");
const app_js_1 = require("./app.js");
const wsServer_js_1 = require("./wsServer.js");
app_js_1.app.listen(config_js_1.config.port, () => {
    const rpcSet = Boolean(process.env.RPC_URL?.trim());
    const tradingCoreSet = Boolean((process.env.TRADING_CORE_ADDRESS ?? process.env.DEPLOYED_TRADING_CORE)?.trim());
    app_js_1.logger.info({ port: config_js_1.config.port, activeMarketsFilter: rpcSet && tradingCoreSet }, "Backend listening");
    if (!rpcSet || !tradingCoreSet) {
        app_js_1.logger.warn("RPC_URL or TRADING_CORE_ADDRESS not set — /api/markets will return all fallback markets (no on-chain filter)");
    }
});
const enableWs = process.env.ENABLE_WS != null
    ? /^(1|true|yes)$/i.test(process.env.ENABLE_WS)
    : !process.env.VERCEL;
if (enableWs) {
    (0, wsServer_js_1.startWsServer)();
}
else {
    app_js_1.logger.info("WebSocket server disabled (ENABLE_WS=false or Vercel runtime); frontend should use polling mode.");
}
