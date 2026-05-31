# Realyx Monitoring

Prometheus config and alert rules for the Realyx stack.

## Layout

- `prometheus.yml` – scrape config and external labels (cluster: realyx, env: production).
- `alerts/trading-alerts.yml` – alert groups: infrastructure, oracle, trading, vault, indexer.

## Usage

**Docker Compose** (from repo root):

```bash
docker-compose up -d prometheus grafana
```

Prometheus will read `infrastructure/monitoring/prometheus.yml` and `alerts/*.yml` if mounted.

**Kubernetes**: Run Prometheus in the same cluster and mount this directory (or the contents) into the Prometheus container so it uses this config and rule files.

## Alert groups

| Group                 | Purpose                          |
|-----------------------|----------------------------------|
| realyx-infrastructure | Backend health, errors, latency, memory, DB connections |
| realyx-oracle         | Price staleness, circuit breaker, deviation |
| realyx-trading        | Liquidation queue, open interest, funding |
| realyx-vault         | Insurance fund, utilization, emergency mode |
| realyx-indexer       | Indexer lag, reorgs              |

Metrics referenced in rules (e.g. `oracle_last_update_timestamp`, `vault_utilization_percent`) must be emitted by the backend or other exporters for alerts to fire.

## Backend metrics

The backend serves Prometheus metrics at `:METRICS_PORT/metrics` (default `:9090`,
a separate internal port from the public API). Out of the box it exposes:

- Default Node/process metrics (event loop lag, GC, heap, CPU).
- `http_requests_total{method,route,status}` — request counter.
- `http_request_duration_seconds{method,route,status}` — latency histogram.
- `ws_active_connections` — current WebSocket client count.

The Kubernetes scrape config targets the pod annotation `prometheus.io/port: "9090"`
and `prometheus.io/path: "/metrics"`. Domain-specific gauges referenced by some
alert rules (oracle/vault) still require their respective exporters.
