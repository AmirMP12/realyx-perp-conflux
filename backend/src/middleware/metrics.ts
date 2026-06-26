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

/**
 * Indexer health gauges. `indexer_lag_blocks` is the single most important
 * signal for a trading backend: how far behind chain head the event store is.
 * Alert on this (e.g. > 50 blocks) to catch a wedged or starved indexer before
 * users see stale portfolios. `indexer_last_sync_ts` exposes the wall-clock of
 * the last successful pulse so a flatlining indexer is also detectable.
 */
const indexerLagBlocks = new client.Gauge({
  name: "realyx_indexer_lag_blocks",
  help: "Chain head block minus last successfully indexed block",
  registers: [registry],
});

const indexerLastSyncTs = new client.Gauge({
  name: "realyx_indexer_last_sync_timestamp_seconds",
  help: "Unix timestamp of the last successful indexer sync pulse",
  registers: [registry],
});

/** Record indexer progress after a sync pulse. */
export function setIndexerLag(lagBlocks: number): void {
  if (Number.isFinite(lagBlocks)) indexerLagBlocks.set(Math.max(0, lagBlocks));
  indexerLastSyncTs.set(Math.floor(Date.now() / 1000));
}

/**
 * Chain-reorg counter. Incremented by the indexer whenever the reorg-aware
 * resume rewinds past orphaned blocks, so the `IndexerReorg` alert
 * (increase[1h] > N) reflects real reorg activity rather than a stub metric.
 */
const indexerReorgTotal = new client.Counter({
  name: "realyx_indexer_reorg_total",
  help: "Total number of chain reorgs the indexer has resolved (rewinds)",
  registers: [registry],
});

/** Record that the indexer resolved a reorg of `depth` orphaned blocks. */
export function recordIndexerReorg(depth: number): void {
  if (Number.isFinite(depth) && depth > 0) indexerReorgTotal.inc();
}

// ── RPC pool health ──
// Per-endpoint request outcomes drive an error-rate alert; the circuit-breaker
// state gauge (0 closed / 0.5 half-open / 1 open) shows failover at a glance.
const rpcRequestsTotal = new client.Counter({
  name: "realyx_rpc_requests_total",
  help: "RPC calls routed through the pool, labeled by endpoint host and outcome",
  labelNames: ["endpoint", "outcome"] as const,
  registers: [registry],
});

const rpcCircuitState = new client.Gauge({
  name: "realyx_rpc_circuit_state",
  help: "RPC endpoint circuit state: 0=closed, 0.5=half-open, 1=open",
  labelNames: ["endpoint"] as const,
  registers: [registry],
});

const rpcRequestDuration = new client.Histogram({
  name: "realyx_rpc_request_duration_seconds",
  help: "Latency of RPC calls routed through the pool",
  labelNames: ["endpoint", "outcome"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/** Record an RPC call outcome for a pool endpoint (host-only label). */
export function recordRpcResult(endpoint: string, outcome: "success" | "failure", latencyMs: number): void {
  try {
    rpcRequestsTotal.inc({ endpoint, outcome });
    rpcRequestDuration.observe({ endpoint, outcome }, latencyMs / 1000);
  } catch {
    /* never let metrics break RPC */
  }
}

/** Update an endpoint's circuit-breaker state gauge. */
export function setRpcCircuitState(endpoint: string, state: "closed" | "half-open" | "open"): void {
  const v = state === "open" ? 1 : state === "half-open" ? 0.5 : 0;
  try {
    rpcCircuitState.set({ endpoint }, v);
  } catch {
    /* ignore */
  }
}

// ── Keeper latency ──
// Time from order creation to keeper execution (reported by the keeper-bot
// webhook), the core signal for execution health on an intent-based DEX.
const keeperExecLatency = new client.Histogram({
  name: "realyx_keeper_execution_latency_seconds",
  help: "Latency from order creation to keeper execution",
  buckets: [0.5, 1, 2, 3, 5, 8, 13, 21, 34],
  registers: [registry],
});

const keeperFailuresTotal = new client.Counter({
  name: "realyx_keeper_failures_total",
  help: "Total keeper execution failures reported via webhook",
  registers: [registry],
});

/** Record a keeper execution latency sample (seconds). */
export function recordKeeperLatency(seconds: number): void {
  if (Number.isFinite(seconds) && seconds >= 0) keeperExecLatency.observe(seconds);
}

/** Record a keeper execution failure. */
export function recordKeeperFailure(): void {
  try {
    keeperFailuresTotal.inc();
  } catch {
    /* ignore */
  }
}

// ── Reconciliation drift ──
// The reconciliation job compares indexed aggregates against authoritative
// on-chain reads and publishes the relative drift so a silent indexer bug
// trips an alert before users see wrong numbers.
const reconciliationDrift = new client.Gauge({
  name: "realyx_reconciliation_drift_ratio",
  help: "Relative drift between indexed aggregate and on-chain truth (0 = exact match)",
  labelNames: ["metric"] as const,
  registers: [registry],
});

const reconciliationLastRunTs = new client.Gauge({
  name: "realyx_reconciliation_last_run_timestamp_seconds",
  help: "Unix timestamp of the last reconciliation run",
  registers: [registry],
});

/** Publish a reconciliation drift ratio for a named metric (e.g. "open_interest", "tvl"). */
export function setReconciliationDrift(metric: string, driftRatio: number): void {
  if (Number.isFinite(driftRatio)) reconciliationDrift.set({ metric }, Math.abs(driftRatio));
  reconciliationLastRunTs.set(Math.floor(Date.now() / 1000));
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
