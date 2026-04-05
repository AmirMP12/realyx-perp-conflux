# Realyx — RWA Perpetual Futures DEX

Trade perpetual futures on Real World Assets (RWA) with up to 10x leverage. Built with **Solidity** (Hardhat), **React + TypeScript** (Vite), **Express** backend, and **The Graph** subgraph for indexing.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Step-by-Step Setup](#step-by-step-setup)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Scripts Reference](#scripts-reference)
- [Docker](#docker)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

Realyx is a decentralized perpetual futures exchange for Real World Assets including crypto, equities, commodities, and forex. Users can:

- **Trade perpetuals** with leverage (up to 10x)
- **Long or short** markets with real-time Pyth oracle prices
- **Manage positions** from Portfolio dashboard
- **Earn yield** via Vault deposits or Insurance staking

The system consists of on-chain smart contracts (TradingCore, VaultCore, OracleAggregator), a backend API that reads from a subgraph and enriches with Pyth/CoinGecko data, and a React frontend (wagmi, RainbowKit).

---

## Features

| Feature | Description |
|---------|-------------|
| **Markets** | Crypto (BTC, ETH, LINK, …), Equities (NVDA, TSLA, AAPL, …), Commodities (Gold), RWAs |
| **Perpetuals** | No expiry; funding rate settlement every hour |
| **Leverage** | Up to 10x configurable per market |
| **Prices** | Pyth Network oracles; fallback to CoinGecko |
| **Trading** | Long/short; limit orders via keeper; market orders |
| **Vault** | LP deposits; share-based accounting; withdrawal queue |
| **Insurance** | Stake to backstop bad debt; earn premiums |
| **Analytics** | Volume history, Open Interest, Leaderboard |
| **WebSocket** | Real-time price and stats updates |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/Vite)                           │
│  Markets | Trading | Portfolio | Vault | Insurance | Analytics | Settings    │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ REST API / WebSocket
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Express)                               │
│  /api/markets | /api/user | /api/stats | /api/leaderboard | /api/insurance   │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ GraphQL + Pyth + CoinGecko
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│    SUBGRAPH     │           │  PYTH NETWORK   │           │   COINGECKO     │
│  (The Graph)    │           │ (Hermes/Bench)  │           │   (fallback)    │
│ Markets, Stats  │           │ Price feeds     │           │ Prices, 24h chg │
└────────┬────────┘           └─────────────────┘           └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CHAIN (Conflux eSpace Testnet)                            │
│  TradingCore | VaultCore | OracleAggregator | PositionToken | MockUSDC      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Contracts** | Solidity 0.8.24, Hardhat, OpenZeppelin, Pyth SDK |
| **Frontend** | React 18, Vite, wagmi, RainbowKit, Zustand, Tailwind, Recharts |
| **Backend** | Node.js, Express, TypeScript, graphql-request, Pino |
| **Indexing** | The Graph (Subgraph Studio) |
| **Oracles** | Pyth Network, CoinGecko (fallback) |
| **RPC** | Conflux eSpace Testnet |

---

## Project Structure

```
realyx-perp-dex/
├── contracts/              # Solidity (TradingCore, VaultCore, OracleAggregator, PositionToken)
├── frontend/               # React app (Vite, wagmi, RainbowKit)
├── backend/                # Express API (subgraph + Pyth + CoinGecko)
├── subgraph/               # The Graph schema and mappings
├── scripts/                # Deploy, verify, setup-market, upgrade
├── deployment/             # Deployed addresses (e.g. confluxTestnet.json)
├── infrastructure/         # Kubernetes, Prometheus, Grafana
├── docs/                   # Analysis, guides
├── docker-compose.yml      # Full stack (backend, frontend, postgres, redis, prometheus, grafana)
├── docker-compose.minimal.yml  # Backend + frontend only
├── hardhat.config.ts
└── package.json            # Root: contracts scripts
```

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** (or yarn/pnpm)
- **Git**
- **Docker** (optional, for containerized run)
- **Wallet** with test CFX (for testnet trading)
- **WalletConnect Project ID** (free at [cloud.walletconnect.com](https://cloud.walletconnect.com))

---

## Quick Start

### Option A: Docker (Recommended for first run)

```bash
git clone <repo-url>
cd realyx-perp-dex

# Minimal: backend + frontend only
docker-compose -f docker-compose.minimal.yml up -d

# Open http://localhost:3000
```

### Option B: Local development

```bash
# 1. Backend
cd backend && npm install && cp .env.example .env && npm run dev

# 2. Frontend (new terminal)
cd frontend && npm install && cp .env.example .env
# Edit .env: VITE_TRADING_CORE_ADDRESS, VITE_VAULT_CORE_ADDRESS, etc. from deployment/confluxTestnet.json
npm run dev

# 3. Open http://localhost:5173
```

---

## Step-by-Step Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd realyx-perp-dex
```

### 2. Root environment (for deployment)

Create `.env` in the repo root (for contracts):

```env
PRIVATE_KEY=<deployer_private_key_no_0x>
CONFLUX_TESTNET_RPC_URL=https://evmtestnet.confluxrpc.com
CONFLUXSCAN_API_KEY=<optional_for_verification>
```

### 3. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=3001
WS_PORT=3002
SUBGRAPH_URL=https://api.studio.thegraph.com/query/1741472/realyx/1.0.0
CHAIN_ID=71
VITE_RPC_URL=https://evmtestnet.confluxrpc.com
TRADING_CORE_ADDRESS=0xDDe4D077C617C1B84dA369fB8fD391BE6530C40E
ORACLE_AGGREGATOR_ADDRESS=0x8190715C58f4d1be1a1EF8FdA44133B77972e9e1
NODE_ENV=development
```

Start backend:

```bash
npm run dev
```

### 4. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3002
VITE_CHAIN_ID=71
VITE_RPC_URL=https://evmtestnet.confluxrpc.com
VITE_WALLET_CONNECT_PROJECT_ID=<your_project_id>
VITE_TRADING_CORE_ADDRESS=0xDDe4D077C617C1B84dA369fB8fD391BE6530C40E
VITE_VAULT_CORE_ADDRESS=0xd74f9539847E8f5b63cd8F09547c9497FbbB83Ee
VITE_ORACLE_AGGREGATOR_ADDRESS=0x8190715C58f4d1be1a1EF8FdA44133B77972e9e1
VITE_POSITION_TOKEN_ADDRESS=0xb812dE8a28614f52fF9ace0688bCF147fF5d824d
VITE_MOCK_USDC_ADDRESS=0x14D21f963EA8a644235Dd4d9D643437310cB4DeF
```

Start frontend:

```bash
npm run dev
```

Open **http://localhost:5173**.

### 5. Connect wallet and testnet assets

1. Connect wallet (MetaMask, etc.) to **Conflux eSpace Testnet**
2. Get test CFX: [Conflux eSpace Testnet Faucet](https://evmtestnet.confluxscan.org/faucet)
3. In the app: **Settings → Testnet tools → Mint 1k Mock USDC**
4. Navigate to **Markets** and start trading

---

## Environment Variables

### Root (contracts)

| Variable | Required | Description |
|----------|----------|-------------|
| PRIVATE_KEY | Yes (deploy) | Deployer private key (no 0x) |
| CONFLUX_TESTNET_RPC_URL | Yes | RPC endpoint |
| CONFLUXSCAN_API_KEY | No | For contract verification |
| USDC_ADDRESS | No | USDC contract address |

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | HTTP server port |
| WS_PORT | 3002 | WebSocket server port |
| SUBGRAPH_URL | (see .env.example) | GraphQL subgraph endpoint |
| CHAIN_ID | 71 | Chain ID |
| RPC_URL | - | For on-chain market filter |
| TRADING_CORE_ADDRESS | - | TradingCore contract |
| ORACLE_AGGREGATOR_ADDRESS | - | OracleAggregator contract |
| NODE_ENV | development | Environment |
| METRICS_PORT | 9090 | Prometheus metrics port |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| VITE_API_URL | http://localhost:3001/api | Backend API base |
| VITE_WS_URL | ws://localhost:3002 | WebSocket URL |
| VITE_CHAIN_ID | 71 | Chain ID |
| VITE_RPC_URL | https://evmtestnet.confluxrpc.com | RPC for wagmi |
| VITE_WALLET_CONNECT_PROJECT_ID | - | **Required** for WalletConnect |
| VITE_TRADING_CORE_ADDRESS | - | **Required** for trading |
| VITE_VAULT_CORE_ADDRESS | - | **Required** for vault |
| VITE_ORACLE_AGGREGATOR_ADDRESS | - | **Required** for prices |
| VITE_POSITION_TOKEN_ADDRESS | - | **Required** for positions |
| VITE_MOCK_USDC_ADDRESS | - | Mock USDC on testnet |
| VITE_MOCK_MODE | false | Set true to use mock data |

---

## API Reference

Base URL: `http://localhost:3001` (or your backend host)

All JSON responses: `{ success: boolean, data?: T, error?: string }`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/markets` | List markets (subgraph + Pyth/CoinGecko) |
| GET | `/api/markets/price-history/:marketId?days=7` | Price history (Pyth or CoinGecko) |
| GET | `/api/user/:address/positions` | User open positions |
| GET | `/api/user/:address/trades?limit=20` | User trade history |
| GET | `/api/stats` | Protocol stats (volume, OI, liquidations) |
| GET | `/api/stats/history` | Daily stats (from subgraph ProtocolMetric) |
| GET | `/api/leaderboard?limit=10&timeframe=all` | Leaderboard by volume |
| GET | `/api/insurance/claims?limit=20` | Bad debt claims |

---

## Scripts Reference

### Root (contracts)

| Script | Description |
|--------|-------------|
| `npm run compile` | Compile contracts |
| `npm run test` | Run Hardhat tests |
| `npm run deploy:conflux-testnet` | Deploy to Conflux eSpace Testnet |
| `npm run deploy:conflux` | Deploy to Conflux eSpace |
| `npm run verify:confluxTestnet` | Verify on Conflux eSpace Testnet Scan |
| `npm run setup:market` | Setup market on Conflux eSpace Testnet |
| `npm run node` | Start local Hardhat node |

### Backend

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server (tsx watch) |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run lint` | ESLint (TypeScript) |

### Frontend

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint (TypeScript/React) |

### Subgraph

| Script | Description |
|--------|-------------|
| `npm run codegen` | Regenerate types from schema |
| `npm run build` | Build subgraph |
| `npm run create:local` | Create subgraph on local Graph Node |
| `npm run deploy:local` | Deploy to local Graph Node |
| `npm run deploy:studio` | Deploy to Graph Studio |

---

## Docker

**Prerequisite:** Ensure Docker Desktop (or Docker Engine) is running before building/starting.

### Minimal (backend + frontend)

```bash
docker compose -f docker-compose.minimal.yml up -d
```

- Frontend: http://localhost:3000 (API and WebSocket proxied via nginx)
- Backend API: http://localhost:3001
- WebSocket: ws://localhost:3002

### Full stack

```bash
docker compose up -d
```

Includes PostgreSQL, Redis, Prometheus, Grafana.

### Graph Node (for Subgraph Indexing)

To run a local Graph Node optimized for Conflux eSpace:

```bash
docker compose -f docker-compose.graph.yml up -d
```

This starts:
- **Graph Node**: `http://localhost:8000` (Queries), `http://localhost:8020` (JSON-RPC)
- **IPFS**: `http://localhost:5001`
- **Postgres**: `localhost:5432` (db: `graph-node`)

### Build images manually

```bash
# Backend
docker build -t realyx/backend:latest ./backend

# Frontend
docker build -t realyx/frontend:latest \
  --build-arg VITE_API_URL=/api \
  --build-arg VITE_WS_URL=ws://localhost:3000/ws \
  --build-arg VITE_TRADING_CORE_ADDRESS=0xDDe4D077C617C1B84dA369fB8fD391BE6530C40E \
  --build-arg VITE_VAULT_CORE_ADDRESS=0xd74f9539847E8f5b63cd8F09547c9497FbbB83Ee \
  --build-arg VITE_ORACLE_AGGREGATOR_ADDRESS=0x8190715C58f4d1be1a1EF8FdA44133B77972e9e1 \
  --build-arg VITE_POSITION_TOKEN_ADDRESS=0xb812dE8a28614f52fF9ace0688bCF147fF5d824d \
  ./frontend
```

---

## Deploy on Vercel

You can run the full app (frontend + API) on a single Vercel project. The backend runs as serverless functions; **WebSocket is not supported** on Vercel, so live price/stat updates are disabled unless you host a separate WebSocket server.

### 1. Connect repository

1. Go to [vercel.com](https://vercel.com) and import your Git repository.
2. Leave **Root Directory** empty (repo root).
3. **Framework Preset:** Other (or Vite — build is overridden in `vercel.json`).

### 2. Environment variables

In the Vercel project **Settings → Environment Variables**, add:

**Backend (used by API):**

- `SUBGRAPH_URL` — Your subgraph GraphQL URL
- `CHAIN_ID` — e.g. `71` (Conflux eSpace Testnet)
- `RPC_URL` — RPC endpoint (optional; enables on-chain market filter)
- `TRADING_CORE_ADDRESS` — TradingCore contract address
- `ORACLE_AGGREGATOR_ADDRESS` — OracleAggregator contract address

**Frontend (build-time, `VITE_*`):**

- `VITE_API_URL` — Set to **`/api`** (same origin; API is under `/api`)
- `VITE_WS_URL` — Leave **empty** (no WebSocket on Vercel)
- `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_WALLET_CONNECT_PROJECT_ID`
- `VITE_TRADING_CORE_ADDRESS`, `VITE_VAULT_CORE_ADDRESS`, `VITE_ORACLE_AGGREGATOR_ADDRESS`, `VITE_POSITION_TOKEN_ADDRESS`, `VITE_MOCK_USDC_ADDRESS` (if on testnet)

### 3. Deploy

Push to your connected branch. Vercel will:

1. Install backend and frontend dependencies (`vercel.json` `installCommand`).
2. Build backend (`backend/dist`), then frontend (`frontend/dist`) (`buildCommand`).
3. Serve the frontend and route `/api/*` and `/health` to the Express app.

### 4. Optional: WebSocket elsewhere

For real-time price/stats, run the full backend (with WebSocket) on Railway, Render, or Fly.io, then set `VITE_WS_URL` to that backend’s WebSocket URL (e.g. `wss://your-backend.up.railway.app`).

---

## Deployment

### Contracts

1. Configure `.env` with `PRIVATE_KEY`, `CONFLUX_TESTNET_RPC_URL`
2. Run `npm run deploy:confluxTestnet`
3. Copy addresses from `deployment/confluxTestnet.json` into frontend/backend `.env`

### Subgraph

1. **Self-hosted (Recommended for Conflux eSpace)**:
   - Run `docker-compose -f docker-compose.graph.yml up -d` in the root.
   - Navigate to `subgraph/` and run `npm run create:local` then `npm run deploy:local`.
2. **Graph Studio**:
   - Create subgraph at [Subgraph Studio](https://thegraph.com/studio/)
   - Run `npm run auth:studio -- <key>` and `npm run deploy:studio`.
3. Copy the GraphQL URL into `SUBGRAPH_URL` in backend `.env`.

### Kubernetes

```bash
kubectl apply -f infrastructure/kubernetes/namespace.yaml
kubectl apply -f infrastructure/kubernetes/configmap.yaml
# Create and apply backend-secrets.yaml from example
kubectl apply -f infrastructure/kubernetes/backend.yaml
kubectl apply -f infrastructure/kubernetes/frontend.yaml
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Markets not loading** | Check `SUBGRAPH_URL` and backend logs. Ensure subgraph is synced. |
| **Prices show 0** | Verify `RPC_URL`, `TRADING_CORE_ADDRESS`. Pyth/CoinGecko may be rate-limited. |
| **Mint Mock USDC fails** | Confirm `VITE_MOCK_USDC_ADDRESS` matches `deployment/confluxTestnet.json`. Connect to Conflux eSpace Testnet. |
| **WalletConnect not connecting** | Set `VITE_WALLET_CONNECT_PROJECT_ID` from [cloud.walletconnect.com](https://cloud.walletconnect.com). |
| **Backend 404** | Ensure routes use `/api` prefix. Frontend should use `VITE_API_URL=http://localhost:3001/api`. |
| **Docker frontend API calls fail** | Use `VITE_API_URL=/api` so nginx proxies to backend. Access app at http://localhost:3000. |
| **Docker "cannot connect" / "pipe not found"** | Start Docker Desktop (Windows/Mac) or ensure Docker daemon is running. |
| **Subgraph 429** | Reduce poll frequency. Backend caches subgraph responses. |

---

## Development

### Code structure

- **Contracts**: `contracts/`, `scripts/`, `test/`
- **Backend**: `backend/src/routes/`, `backend/src/services/`
- **Frontend**: `frontend/src/pages/`, `frontend/src/components/`, `frontend/src/hooks/`
- **Subgraph**: `subgraph/schema.graphql`, `subgraph/src/`

### Run tests

```bash
# Contracts
npm run test

# Backend (if tests exist)
cd backend && npm test

# Frontend (if tests exist)
cd frontend && npm test
```

### Lint

```bash
npm run lint        # Contracts (Prettier)
cd backend && npm run lint
cd frontend && npm run lint
```

### More docs

- [backend/README.md](backend/README.md) — Backend API details
- [subgraph/README.md](subgraph/README.md) — Subgraph deploy & schema
- [infrastructure/README.md](infrastructure/README.md) — Kubernetes & monitoring

---

## License

MIT
