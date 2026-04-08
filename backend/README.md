# Realyx — Backend

REST API and (optional) WebSocket backend that reads from the **database indexer** and serves the frontend (`useBackend.ts`, `api.ts`).

## Contract / database indexer context

See [../docs/CONTRACT_ANALYSIS.md](../docs/CONTRACT_ANALYSIS.md) and [../database indexer/README.md](../database indexer/README.md).

## Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env: POSTGRES_URL (Graph Node endpoint), PORT, CHAIN_ID
```

## Run

```bash
npm run dev    # tsx watch
# or
npm run build && npm start
```

## API (base: `/api`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/markets` | List markets (from database indexer) |
| GET | `/api/user/:address/positions` | User open positions |
| GET | `/api/user/:address/trades?limit=20` | User trade history |
| GET | `/api/stats` | Protocol stats (totalMarkets, volume24h, totalOpenInterest) |
| GET | `/api/stats/history` | Daily stats (placeholder) |
| GET | `/api/leaderboard?limit=10` | Leaderboard by volume |

All JSON responses follow `{ success: boolean, data?: T, error?: string }`.

## Health

- `GET /health` → `{ ok: true, ts: "..." }`

## Env

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | HTTP server port |
| WS_PORT | 3002 | WebSocket server port (reserved) |
| POSTGRES_URL | local Graph Node | database indexer GraphQL endpoint |
| CHAIN_ID | 71 | Chain ID (Conflux Testnet) |
| NODE_ENV | development | Environment |
| METRICS_PORT | 9090 | Metrics port (for Prometheus) |

## Structure

```
backend/
├── src/
│   ├── index.ts         # Express app, routes mount
│   ├── config.ts        # Env config
│   ├── types/           # API types (align with frontend)
│   ├── routes/          # markets, user, stats, leaderboard
│   └── services/        # database indexer.ts (GraphQL client)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Docker

```bash
cd backend
docker build -t realyx/backend:latest .
docker run -p 3001:3001 -e POSTGRES_URL=https://api.thegraph.com/database indexers/name/... realyx/backend:latest
```

Override env with `-e` or an env file. The image exposes port 3001.

## Deployment

- Kubernetes: see `infrastructure/kubernetes/` (backend.yaml uses `backend-config` ConfigMap and optional `backend-secrets`).
