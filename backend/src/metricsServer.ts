/**
 * Dedicated Prometheus metrics server.
 *
 * Runs on METRICS_PORT (default 9090) and serves `/metrics` and `/health`.
 * Kept on a separate port from the public API so metrics are only reachable
 * from inside the cluster (the ingress only routes the API/WS ports).
 */

import http from "http";
import { config } from "./config.js";
import { renderMetrics } from "./middleware/metrics.js";

export function startMetricsServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      try {
        const { contentType, body } = await renderMetrics();
        res.writeHead(200, { "Content-Type": contentType });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`# metrics error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    if (req.url === "/health" || req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.on("error", (err) => {
    // Don't crash the process if the metrics port is unavailable.
    console.error("[metrics] server error:", err);
  });

  server.listen(config.metricsPort, () => {
    console.info(`[metrics] Prometheus metrics on :${config.metricsPort}/metrics`);
  });

  return server;
}
