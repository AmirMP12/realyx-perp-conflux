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

The backend utilizes a sophisticated SQL-based indexing engine to calculate real-time protocol metrics:
- **Cumulative Volume**: Aggregates all `PositionOpened`, `PositionClosed`, and `PositionLiquidated` sizes from the PostgreSQL event store.
- **24h Volume**: Dynamically filters event logs using shifting windows to provide accurate sliding-window volume metrics.
- **Market Specifics**: Individual market volumes are computed by mapping on-chain market addresses to indexed event IDs, ensuring zero discrepancy between the trade history and global stats.

---

## API (base: `/api`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/markets` | Markets with OI, funding, and current price hints |
| GET | `/api/markets/price-history/:marketId?days=7` | Historical prices for a market |
| GET | `/api/user/:address/positions` | User open positions |
| GET | `/api/user/:address/trades?limit=20` | User trade history |
| GET | `/api/stats` | Protocol stats (`totalMarkets`, `volume24h`, `totalOpenInterest`, `totalLiquidations`) |
| GET | `/api/stats/history` | Daily metric history |
| GET | `/api/leaderboard?limit=10&timeframe=all` | Leaderboard by volume/PnL |
| GET | `/api/insurance/claims?limit=20` | Insurance/bad debt claim events |
| GET | `/api/sync` | Manual index sync endpoint (optional bearer auth) |

All JSON responses follow `{ success: boolean, data?: T, error?: string }`.

## Health

- `GET /health` basic liveness
- `GET /health/detailed` dependency and config checks

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | HTTP server port |
| WS_PORT | 3002 | Native WebSocket server port |
| ENABLE_WS | true | Set `false` on Vercel/serverless |
| ENABLE_ACTIVE_MARKETS_FILTER | true | Set `false` on Vercel for faster responses |
| ENABLE_PYTH_24H | true | Set `false` on Vercel to skip expensive per-market 24h history |
| POSTGRES_URL | - | PostgreSQL connection string |
| CHAIN_ID | 71 | Chain ID |
| RPC_URL | chain default | Primary RPC endpoint |
| RPC_FALLBACK_URL | - | Fallback RPC endpoint |
| TRADING_CORE_ADDRESS | - | TradingCore used by active market filters/sync |
| DEPLOYED_TRADING_CORE | - | Alternate TradingCore env fallback |
| CRON_SECRET | - | Optional bearer token for `/api/sync` |
| NODE_ENV | development | Runtime mode |
| METRICS_PORT | 9090 | Metrics port config |

## Structure

```text
backend/
├── src/
│   ├── app.ts           # Express app + route wiring
│   ├── index.ts         # HTTP + optional WS startup
│   ├── config.ts        # Env loading and defaults
│   ├── routes/          # markets, user, stats, leaderboard, insurance, sync, health
│   └── services/        # indexer, pyth, coingecko, activeMarkets
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

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
- Vercel: run in polling mode by setting `ENABLE_WS=false`.
