/**
 * Dedicated WebSocket service entrypoint.
 *
 * Railway (and most PaaS hosts) route exactly one port per service — `$PORT`.
 * The combined API process binds the WS broadcaster to its own `WS_PORT`, which
 * is therefore not publicly reachable on such hosts. This entrypoint runs the
 * broadcaster as its own service: it stands up a minimal HTTP server on `$PORT`
 * (serving `/health` for the platform healthcheck) and attaches the WebSocket
 * upgrade handler to that same port, so a single routable port serves both.
 *
 * Deploy with `railway.ws.json` (startCommand: `node dist/wsWorker.js`).
 */
import http from "http";
import { config } from "./config.js";
import { logger } from "./app.js";
import { startWsServer } from "./wsServer.js";

export function bootstrapWs() {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "ws" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  // Attach the WS broadcaster to the same routable port as the health server.
  const stopWs = startWsServer({ server });

  server.listen(config.port, () => {
    logger.info({ port: config.port }, "WebSocket service listening ($PORT)");
  });

  registerShutdown(server, stopWs);
  return { server, stopWs };
}

function registerShutdown(server: http.Server, stopWs: () => void) {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down WebSocket service gracefully");
    try {
      stopWs();
    } catch {
      /* ignore */
    }
    server.close((err) => {
      if (err) {
        logger.error({ err }, "Error during WS server close");
        process.exit(1);
      }
      logger.info("WebSocket service shutdown complete");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Forced WS shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Auto-bootstrap outside tests.
if (process.env.NODE_ENV !== "test") {
  bootstrapWs();
}
