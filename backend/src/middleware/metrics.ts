/**
 * Request metrics middleware + Prometheus registry.
 *
 * Collects HTTP request counts and latency histograms (exposed at the metrics
 * endpoint for Prometheus scraping) and keeps the lightweight console logging
 * for 5xx and slow requests in development.
 */

import type { Request, Response, NextFunction } from "express";
import client from "prom-client";

/** Shared Prometheus registry. */
export const registry = new client.Registry();
registry.setDefaultLabels({ app: "realyx-backend" });

// Default process/Node metrics (event loop lag, GC, memory, CPU, ...).
client.collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const wsConnections = new client.Gauge({
  name: "ws_active_connections",
  help: "Number of active WebSocket connections",
  registers: [registry],
});

/** Update the active WebSocket connection gauge. */
export function setWsConnections(n: number): void {
  wsConnections.set(n);
}

/** Render all metrics in Prometheus text exposition format. */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}

/**
 * Normalise a request path into a low-cardinality route label so we don't
 * explode the metric series with addresses, ids, etc.
 */
function routeLabel(req: Request): string {
  if (req.route?.path && req.baseUrl !== undefined) {
    return `${req.baseUrl}${req.route.path}`;
  }
  return (req.baseUrl || req.path || "unknown")
    .replace(/0x[a-fA-F0-9]{40}/g, ":address")
    .replace(/\b\d+\b/g, ":id");
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const latencyMs = Date.now() - start;
    const status = res.statusCode;
    const method = req.method;
    const route = routeLabel(req);

    try {
      const labels = { method, route, status: String(status) };
      httpRequestsTotal.inc(labels);
      httpRequestDuration.observe(labels, latencyMs / 1000);
    } catch {
      /* never let metrics break a request */
    }

    if (status >= 500) {
      console.warn(`[metrics] ${method} ${route} ${status} ${latencyMs}ms`);
    } else if (process.env.NODE_ENV === "development" && latencyMs > 1000) {
      console.info(`[metrics] ${method} ${route} ${status} ${latencyMs}ms (slow)`);
    }
  });
  next();
}
