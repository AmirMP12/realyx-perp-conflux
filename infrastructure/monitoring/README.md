# Realyx Monitoring

Prometheus config and alert rules for the Realyx stack.

## Layout

- `prometheus.yml` – scrape config and external labels (cluster: realyx, env: production) for Kubernetes.
- `prometheus-docker.yml` – scrape config used by the Docker Compose Prometheus service (scrapes `backend:9090`, loads alert rules).
- `alerts/trading-alerts.yml` – alert groups: infrastructure, oracle, trading, vault, indexer, rpc, keeper, data-quality, websocket.
- `grafana/provisioning/datasources/` – Prometheus datasource.
- `grafana/provisioning/dashboards/` – dashboard provider + `realyx-observability.json` (indexer lag, RPC error rate / circuit state, keeper latency, WS connections, reconciliation drift).

## Usage

**Docker Compose** (from repo root):

```bash
docker-compose up -d prometheus grafana
```

The Compose `prometheus` service mounts `infrastructure/monitoring/prometheus-docker.yml` and the `grafana` service mounts `grafana/provisioning/`. Grafana is exposed on host port 3003 (admin password via `GRAFANA_PASSWORD`).

**Kubernetes**: Run Prometheus in the same cluster and mount this directory (or the contents) into the Prometheus container so it uses this config and rule files.

## Alert groups

| Group                 | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| realyx-infrastructure | Backend health, errors, latency, memory, DB connections |
| realyx-oracle         | Price staleness, circuit breaker, deviation             |
| realyx-trading        | Liquidation queue, open interest, funding               |
| realyx-vault          | Insurance fund, utilization, emergency mode             |
| realyx-indexer        | Indexer lag (blocks behind head), stalled sync, reorgs  |
| realyx-rpc            | Per-endpoint RPC error rate, circuit breakers open      |
| realyx-keeper         | Slow/failed keeper execution                            |
| realyx-data-quality   | Indexed-vs-on-chain drift, reconciliation stalled       |
| realyx-websocket      | WS connections flatlined while backend is up            |

Metrics referenced in rules (e.g. `oracle_last_update_timestamp`, `vault_utilization_percent`) must be emitted by the backend or other exporters for alerts to fire.

## Backend metrics

The backend serves Prometheus metrics at `:METRICS_PORT/metrics` (default `:9090`,
a separate internal port from the public API). It exposes:

**HTTP & process**

- Default Node/process metrics (event loop lag, GC, heap, CPU).
- `http_requests_total{method,route,status}` — request counter.
- `http_request_duration_seconds{method,route,status}` — latency histogram.

**WebSocket**

- `ws_active_connections` — current WebSocket client count.

**Indexer**

- `realyx_indexer_lag_blocks` — chain head minus last indexed block (the key staleness signal).
- `realyx_indexer_last_sync_timestamp_seconds` — wall-clock of the last successful pulse (flatlines if wedged).
- `realyx_indexer_reorg_total` — reorgs resolved by the reorg-aware indexer.

**RPC pool**

- `realyx_rpc_requests_total{endpoint,outcome}` — per-endpoint success/failure counter (drives error-rate alert).
- `realyx_rpc_request_duration_seconds{endpoint,outcome}` — per-endpoint latency histogram.
- `realyx_rpc_circuit_state{endpoint}` — circuit breaker: 0 closed / 0.5 half-open / 1 open.

**Keeper**

- `realyx_keeper_execution_latency_seconds` — order-create → on-chain execution latency (reported via `POST /api/v1/keeper/executed`).
- `realyx_keeper_failures_total` — keeper execution failures (reported via `POST /api/v1/keeper/failure`).

**Data quality (reconciliation)**

- `realyx_reconciliation_drift_ratio{metric}` — relative drift between indexed aggregates and on-chain truth (`open_interest`, `tvl`). 0 = exact match.
- `realyx_reconciliation_last_run_timestamp_seconds` — last reconciliation pass time.

The Docker Compose Prometheus scrapes `backend:9090`. The Kubernetes scrape config targets the pod annotation `prometheus.io/port: "9090"` and `prometheus.io/path: "/metrics"`. Domain-specific gauges referenced by some oracle/vault alert rules still require their respective exporters.

## Reconciliation job

A background loop (`services/reconciliation.ts`) periodically compares the
indexer's aggregate **open interest** against the on-chain
`TradingCore` market sizes, and reads **TVL** from `VaultCore.totalAssets()`,
publishing `realyx_reconciliation_drift_ratio`. This catches silent indexer bugs
(double-counts, missed logs) before users see wrong numbers — the
`ReconciliationDrift` alert fires at >5% drift. The loop runs on long-lived
processes only (not serverless runtimes) and is configurable via
`RECONCILE_INTERVAL_MS` (default 5m); disable with `DISABLE_RECONCILIATION=true`.
