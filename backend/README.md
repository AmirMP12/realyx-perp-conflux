# Realyx Backend

Express + TypeScript API layer that reads indexed on-chain data from PostgreSQL and serves the frontend.

## Setup

From the **project root**:
```bash
npm install
npm install --workspace backend
cp backend/.env.example backend/.env
```

Or from the **backend directory**:
```bash
npm install
cp .env.example .env
```

Minimum env to run meaningful responses: `POSTGRES_URL`, `CHAIN_ID`, `RPC_URL`, and `TRADING_CORE_ADDRESS`.

## Run

```bash
npm run dev
# or
npm run build && npm start
```

## 📊 Volume Indexing Engine

The backend utilizes a SQL-based indexing engine to calculate real-time protocol metrics:
- **Cumulative Volume**: Aggregates all `PositionOpened`, `PositionClosed`, and `PositionLiquidated` sizes from the PostgreSQL event store.
- **24h Volume**: Filters event logs using a sliding `block_time` window for accurate 24h metrics.
- **Market Specifics**: Individual market volumes map on-chain market addresses to indexed events so trade history and global stats stay consistent.

### Scaling & performance

- **Indexes**: `position_events` is indexed on `block_time`, `(market_id, block_time)`, `(event_type, block_time)`, `account`, and the `data->>0` position id. These keep the sliding-window volume/leaderboard scans off full-table scans as the event store grows. They are created idempotently on init (`runSync`).
- **Response cache**: `/api/markets` and `/api/stats` are read-heavy and identical across users, so they are served through a shared read-through cache (`services/cache.ts`) with single-flight de-duplication of concurrent misses. Backed by Redis when `REDIS_URL` is set (shared across replicas), otherwise an in-process LRU+TTL store.
- **Read replicas**: Set `POSTGRES_READ_URL` to route the heavy aggregate reads to a replica; the indexer's writes always target the primary `POSTGRES_URL`.
- **RPC pool**: All on-chain reads go through `services/rpcPool.ts`, which health-routes across the configured endpoints (`RPC_URL`, `RPC_FALLBACK_URL`, `RPC_URLS`, plus chain defaults) and fails over automatically, marking failing endpoints with a cooldown. `/health/detailed` reports per-endpoint status and whether a read replica / Redis cache is active.

---

## API (base: `/api`, also mirrored under `/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/markets` | Markets with OI, funding, and current price hints |
| GET | `/api/markets/price-history/:marketId?days=7` | Historical prices for a market |
| GET | `/api/user/:address/positions` | User open positions |
| GET | `/api/user/:address/trades?limit=20` | User trade history |
| GET | `/api/stats` | Protocol stats (`totalMarkets`, `volume24h`, `totalOpenInterest`, `totalLiquidations`) |
| GET | `/api/stats/history` | Daily metric history |
| GET | `/api/vault/yield` | LP real-yield breakdown — APR by source (borrow/trading fees, funding, liquidations) + 30d APR history, normalized to live TVL |
| GET | `/api/status` | Public transparency feed — overall + per-component health (oracle, RPC, indexer, vault), uptime, vault solvency / insurance-fund metrics |
| GET | `/api/leaderboard?limit=10&timeframe=all` | Leaderboard by volume/PnL |
| GET | `/api/insurance/claims?limit=20` | Insurance/bad debt claim events |
| GET | `/api/referrals/stats?address=0x...` | On-chain referral stats for a wallet |
| GET | `/api/pyth-refresh` | Refresh cached Pyth prices (optional `CRON_SECRET`) |
| GET | `/api/sync` | Manual index sync endpoint (optional bearer auth) |

All JSON responses follow `{ success: boolean, data?: T, error?: string }`.

### Copy-trading (social) — `/api/v1/social`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/social/top-traders` | Lead traders ranked by ROI |
| GET | `/api/v1/social/trader/:address` | Lead-trader profile + open positions |
| GET | `/api/v1/social/copier/:address/following` | Lead traders a copier follows |
| GET | `/api/v1/social/copier/:address/pnl` | Aggregated copied PnL per lead trader |
| POST | `/api/v1/social/refresh` | Refresh the copy engine cache |

Returns `501`/empty when the copy-trading schema is not provisioned.

### Internal / authenticated endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/key` | EIP-712 signature | Issue a tiered API key for a wallet |
| GET | `/api/v1/auth/verify` | `x-api-key` header | Verify an API key, return tier/owner |
| POST | `/api/v1/keeper/failure` | `Authorization: Bearer KEEPER_WEBHOOK_SECRET` | Keeper-bot failure webhook (broadcast to user WS). Disabled in prod if no secret. |
| GET | `/api/v1/keeper/failures/:traderAddress` | — | Historical keeper failures for a user |
| GET | `/api/debug` | `DEBUG_SECRET` (Bearer or `?key=`) in prod | Indexer/DB diagnostics. Returns 404 in prod when no secret set. |
| GET | `/api/sync` | `CRON_SECRET` (Bearer) or `?key=force` | Manual index sync. |

## Health & Metrics

- `GET /health` basic liveness (public API port)
- `GET /health/detailed` dependency and config checks
- `GET /metrics` Prometheus metrics on `METRICS_PORT` (separate internal port, not exposed via Ingress)

Metrics include default Node/process metrics, `http_requests_total`,
`http_request_duration_seconds`, and `ws_active_connections`. These back the
Prometheus scrape config and alert rules in `infrastructure/monitoring/`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | HTTP server port |
| WS_PORT | 3002 | Native WebSocket server port |
| ENABLE_WS | true | Set `false` for serverless / polling mode |
| ENABLE_ACTIVE_MARKETS_FILTER | true | Set `false` for faster responses |
| ENABLE_PYTH_24H | true | Set `false` to skip expensive per-market 24h history |
| POSTGRES_URL | - | PostgreSQL connection string (primary / writer) |
| POSTGRES_READ_URL | - | Optional read-replica connection string. When set, read-heavy API queries (markets, stats, leaderboard, history) route here; writes always use `POSTGRES_URL`. Falls back to the primary when unset. |
| REDIS_URL | - | Optional Redis URL for the shared response cache (markets/stats hot paths). Requires the optional `ioredis` package; falls back to an in-process LRU+TTL cache when unset or missing. Enables a cache shared across replicas. |
| CHAIN_ID | 71 | Chain ID |
| RPC_URL | chain default | Primary RPC endpoint |
| RPC_FALLBACK_URL | - | Additional RPC endpoint added to the pool |
| RPC_URLS | - | Comma-separated RPC endpoint pool (alternative to RPC_URL/RPC_FALLBACK_URL). All endpoints are health-routed with automatic failover. |
| TRADING_CORE_ADDRESS | - | TradingCore used by active market filters/sync |
| DEPLOYED_TRADING_CORE | - | Alternate TradingCore env fallback |
| CRON_SECRET | - | Optional bearer token for `/api/sync` |
| CORS_ORIGINS | - | Comma-separated browser CORS allowlist. Unset reflects any origin (dev only) |
| KEEPER_WEBHOOK_SECRET | - | Bearer secret for `/api/v1/keeper/failure`. Required in prod |
| DEBUG_SECRET | - | Secret guarding `/api/debug` in prod (Bearer or `?key=`) |
| NODE_ENV | development | Runtime mode |
| METRICS_PORT | 9090 | Prometheus metrics server port (`/metrics`) |

## Graceful shutdown

On `SIGTERM`/`SIGINT` the server stops the background sync loop, closes the
WebSocket and metrics servers, and drains in-flight HTTP connections (10s
failsafe). This makes Kubernetes rolling deploys clean.

## Structure

```text
backend/
├── src/
│   ├── app.ts           # Express app + route wiring (legacy + /api/v1)
│   ├── index.ts         # HTTP + optional WS startup (API process)
│   ├── worker.ts        # Standalone indexer worker (the only DB writer; `node dist/worker.js`)
│   ├── metricsServer.ts # Prometheus metrics server (separate internal port)
│   ├── wsServer.ts      # Native WebSocket broadcaster
│   ├── config.ts        # Env loading and defaults
│   ├── routes/          # markets, user, stats, vault, status, leaderboard, insurance,
│   │                    #   referrals, social, keeper, auth, pythRefresh, sync, debug, health
│   ├── services/        # indexer, pyth, coingecko, activeMarkets, copyEngine,
│   │                    #   fetchMarketsOnchain, db, cache, rpcPool, reconciliation
│   ├── middleware/      # rateLimit, metrics
│   ├── constants/       # markets metadata (MARKET_META)
│   ├── abi/             # contract ABIs consumed by the indexer
│   ├── types/           # shared TS types
│   ├── utils/           # formatting helpers
│   └── __tests__/       # Jest test suite
├── tsconfig.json        # build config
├── jest.config.js
├── Dockerfile
├── package.json
├── .env.example
└── README.md
```

Two runtime entrypoints share this code:
- **API** (`index.js`) — serves REST (`PORT`) and, when `ENABLE_WS=true`, WebSockets (`WS_PORT`). Runs as a pure reader when `DISABLE_INBAND_SYNC=true`.
- **Indexer** (`worker.js`) — the single chain-ingestion writer to the primary Postgres. Reorg-aware, idempotent on `(tx_hash, log_index)`.

## Docker

```bash
cd backend
docker build -t realyx/backend:latest .
docker run --rm -p 3001:3001 -p 3002:3002 \
  -e POSTGRES_URL=postgres://user:pass@host:5432/realyx \
  -e RPC_URL=https://evmtestnet.confluxrpc.com \
  -e TRADING_CORE_ADDRESS=0x... \
  realyx/backend:latest
```

## Deployment

- Kubernetes: see `infrastructure/kubernetes/`.
- Serverless: run in polling mode by setting `ENABLE_WS=false`.

### Railway

Railway routes exactly one port per service (`$PORT`). Deploy as **three services**
from this same `backend/` directory and Dockerfile, each with a different config file:

| Service | Config file | Start command | Public? |
| --- | --- | --- | --- |
| API | `railway.json` | `node dist/index.js` | yes (`/health`) |
| Indexer worker | `railway.indexer.json` | `node dist/worker.js` | no |
| WebSocket | `railway.ws.json` | `node dist/wsWorker.js` | yes (`/health`) |

The WebSocket service (`wsWorker.js`) stands up a health server on `$PORT` and
attaches the broadcaster to that same routable port, so it works under Railway's
single-port model. Point the frontend's WS URL at this service's public domain.

Required environment variables (set in the Railway dashboard — `.env` files are
`.dockerignore`d and never shipped):

- `NODE_ENV=production` (enables Postgres SSL)
- `POSTGRES_URL` — from a Railway Postgres plugin
- `RPC_URL`, `TRADING_CORE_ADDRESS`, `VAULT_CORE_ADDRESS`, `ORACLE_AGGREGATOR_ADDRESS`, `REFERRAL_REGISTRY_ADDRESS`
- `CORS_ORIGINS` — your frontend origin(s); leaving it unset reflects any origin (dev only)
- Secrets for guarded endpoints, if used: `KEEPER_WEBHOOK_SECRET`, `DEBUG_SECRET`, `CRON_SECRET`

Coordination:

- Set `DISABLE_INBAND_SYNC=true` on the **API** service so it's a pure reader and
  the dedicated worker owns ingestion. (Ingestion is serialized cluster-wide by a
  Postgres advisory lock, so overlap is safe either way — this just avoids
  redundant scans.)
- If you don't want a separate WebSocket service, instead set `ENABLE_WS=false`
  on the API and the frontend falls back to REST polling.

