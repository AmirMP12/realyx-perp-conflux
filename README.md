# Realyx — RWA Perpetual Futures DEX

Trade perpetual futures on Real World Assets (RWA) with up to 10x leverage. Built with **Solidity** (Hardhat), **React + TypeScript** (Vite), **Express** backend, and a **native PostgreSQL** database indexer for indexing.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Conflux](https://img.shields.io/badge/built%20on-Conflux-blue)](https://confluxnetwork.org)
[![Hackathon](https://img.shields.io/badge/Global%20Hackfest%202026-green)](https://github.com/conflux-fans/global-hackfest-2026)

## Overview
Realyx is a decentralized perpetual futures exchange for Real World Assets including crypto, equities, commodities, and forex. Users can long or short markets with up to 10x leverage using real-time Pyth oracle prices. The system consists of on-chain smart contracts (TradingCore, VaultCore, OracleAggregator), a backend API orchestrating off-chain data (Pyth/CoinGecko), a PostgreSQL event indexer, and a React frontend.

## 🏆 Hackathon Information
- **Event**: Global Hackfest 2026
- **Focus Area**: Open Innovation - Build anything you want using Conflux features
- **Team**: AmirMP12
- **Submission Date**: 2026-05-04 @ 11:59:59

## 👥 Team
| Name | Role | GitHub | Discord |
|------|------|--------|---------|
| Amir | Full-Stack/Contract Developer | [@AmirMP12](https://github.com/AmirMP12) | AmirMP12 |

## 🚀 Problem Statement
**What problem does your project solve?**
Current DeFi perpetual exchanges are limited to synthetic crypto assets. Traditional finance (TradFi) platforms restrict global access to real-world assets (RWAs) like equities and commodities due to high entry barriers, geographic restrictions, and custodial risks. There is a need for a unified, decentralized platform where users can seamlessly trade both crypto and RWAs with leverage.

## 💡 Solution
**How does your project address the problem?**
Realyx provides a decentralized perpetual futures DEX on Conflux eSpace.
- **Unified Markets:** Users can trade Crypto (BTC, ETH, LINK, …), Equities (NVDA, TSLA, AAPL, …), Commodities (Gold), and other RWAs.
- **Oracle Integrated:** Real-time pricing via Pyth Network oracles with fallback.
- **Yield Opportunities:** Users can act as LPs in the Vault or stake in Insurance to earn premiums.
- **Leverage:** Configurable leverage up to 10x without expiration dates.

## Go-to-Market Plan (required)
- **Target Audience:** DeFi traders looking for exposure to TradFi assets and crypto-native users wanting non-custodial RWA trading.
- **Acquisition Strategy:** Launch trading competitions on Conflux testnet/mainnet, partner with oracle providers (e.g. Pyth) for co-marketing, and incentivize Vault LPs via protocol tokens.
- **Metrics:** Total Value Locked (TVL) in Vaults, Daily Trading Volume, Open Interest, Protocol Revenue.
- **Ecosystem Fit:** Brings a robust DeFi primitive to Conflux eSpace, enhancing liquidity and use case availability on the network.

## ⚡ Conflux Integration
**How does your project leverage Conflux features?**

- [x] **eSpace** - Smart contracts are deployed on Conflux eSpace, taking advantage of EVM compatibility for standard tooling (Hardhat) and low transaction fees for high-frequency trading.
- [ ] **Core Space** 
- [ ] **Cross-Space Bridge** 
- [ ] **Gas Sponsorship** 
- [ ] **Built-in Contracts** 
- [ ] **Tree-Graph Consensus** 

- [ ] **Privy** 
- [x] **Pyth Network** - Integration with Pyth Network for high-fidelity, low-latency price feeds for diverse markets (crypto, equities, commodities).
- [ ] **LayerZero** 
- [x] **Other** - Native PostgreSQL Indexer for efficient on-chain data indexing optimized for Conflux eSpace.

### Core Features
- **Markets** - Crypto (BTC, ETH), Equities (NVDA, TSLA), Commodities (Gold), RWAs
- **Perpetuals** - No expiry; funding rate settlement every hour
- **Trading** - Long/short perpetuals; limit orders via keeper; market orders.
- **Vault** - LP deposits, share-based accounting, withdrawal queue.
- **Insurance** - Stake to backstop bad debt; earn premiums.

### Advanced Features
- **Analytics** - Volume history, Open Interest tracking, Leaderboard.
- **WebSocket** - Real-time price and stats updates.

### Future Features (Roadmap)
- **Multi-collateral Support** - Allow users to use diverse stablecoins and volatile assets as collateral.
- **One-Click Trading** - Enhance UI with session keys for seamless transaction approvals.

### Frontend
- **Framework**: React 18, Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Web3 Integration**: wagmi, RainbowKit

### Backend
- **Runtime**: Node.js
- **Framework**: Express, TypeScript
- **Database**: PostgreSQL & Redis
- **APIs**: REST API, WebSocket, SQL Indexer integration

### Blockchain
- **Network**: Conflux eSpace Testnet
- **Smart Contracts**: Solidity 0.8.24
- **Development**: Hardhat
- **Oracles**: Pyth Network, CoinGecko (fallback)

### Infrastructure
- **Hosting**: Docker, Kubernetes (for production), Vercel (for frontend/API)
- **Indexing**: PostgreSQL Database
- **Monitoring**: Prometheus, Grafana, Pino

## 🏗️ Architecture
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
                                         │ SQL + Pyth + CoinGecko
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│  DATABASE INDEXER │           │  PYTH NETWORK   │           │   COINGECKO     │
│  (PostgreSQL)   │           │ (Hermes/Bench)  │           │   (fallback)    │
│ Markets, Stats  │           │ Price feeds     │           │ Prices, 24h chg │
└────────┬────────┘           └─────────────────┘           └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CHAIN (Conflux eSpace Testnet)                            │
│  TradingCore | VaultCore | OracleAggregator | PositionToken | MockUSDC      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**High-level architecture description:**
The system uses an Express backend to aggregate on-chain state (via deeply indexed database indexer data) with high-fidelity off-chain price feeds. The React frontend interacts with this API for fast UX, sending transactions via wagmi directly to Conflux eSpace. 

## 📋 Prerequisites
Before you begin, ensure you have the following installed:

- **Node.js** (≥ 18)
- **npm** (or yarn/pnpm)
- **Git**
- **Docker** (optional, for containerized run)
- **Wallet** with test CFX (for testnet trading)
- **WalletConnect Project ID** (free at [cloud.walletconnect.com](https://cloud.walletconnect.com/))

### 1. Clone the Repository
```bash
git clone https://github.com/AmirMP12/realyx-perp-dex.git
cd realyx-perp-dex
```

### 2. Install Dependencies
```bash
# Install root dependencies first (contracts/scripts/build tooling)
npm install

# Optional: explicitly ensure workspace deps are installed
npm install --workspace backend
npm install --workspace frontend
```

### 3. Environment Configuration
Create environment files from examples:

```bash
# Root environment (for deployment)
# Create .env and set PRIVATE_KEY and CONFLUX_TESTNET_RPC_URL

# Backend environment
cp backend/.env.example backend/.env

# Frontend environment
cp frontend/.env.example frontend/.env
```

Review environment variables for correctness. For frontend, provide the addresses from `deployment/confluxTestnet.json`.

### 4. Smart Contract Deployment (if applicable)
```bash
# Compile contracts
npm run compile

# Deploy to Conflux eSpace Testnet
npm run deploy:conflux-testnet

# Verify on Conflux eSpace Testnet Scan
npm run verify:conflux-testnet

# Setup Market on Testnet
npm run setup:market
```

### 5. Start Development Servers
**Option A: Docker (Recommended)**
```bash
# Minimal: backend + frontend only
docker-compose -f docker-compose.minimal.yml up -d
```
Access at `http://localhost:3000`.

**Option B: Local setup**
```bash
# Start backend
cd backend
npm run dev

# Start frontend (in another terminal)
cd frontend
npm run dev
```
Your application should now be running at `http://localhost:5173`.

### Run Tests
```bash
# Run smart contract tests
npm run test

# Run backend tests
cd backend && npm test

# Run frontend tests
cd frontend && npm test

# Linting
npm run lint        # Contracts (Prettier)
cd backend && npm run lint
cd frontend && npm run lint
```

### Getting Started workflows
1. **Connect Wallet**
   - Open the application in your browser.
   - Connect to **Conflux eSpace Testnet**.
   - Obtain test CFX from the [Conflux eSpace Testnet Faucet](https://evmtestnet.confluxscan.org/faucet).
2. **Mint Test Tokens**
   - Navigate to **Settings -> Testnet tools**
   - Click "Mint 1k Mock USDC"
3. **Trade**
   - Navigate to **Markets**
   - Select leverage and trade either long or short!

### Deployed Contracts
#### Testnet
| Contract | Address |
|----------|---------|
| TradingCore | `0x64f277f73bfc81Ad80286a4266c0E0613d867Df3` |
| VaultCore | `0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714` |
| OracleAggregator | `0x89cC8eAbF2e967d81FD04D1023298A3bDcE67450` |
| PositionToken | `0x4368b5741A105c1ACE50ad98581fDa050685fa8B` |
| MockUSDC | `0xa56Ba38f3c820D6cf31a68CBBD0d25c0F5644d35` |

Same deploy (`deployment/confluxTestnet.json`): TradingCoreViews `0x944d4030CEc4Bf552d8E46dC684B70B100Eb0b86`, MarketCalendar `0xD3c20cca25Dd8189ed6115A1b65192d831ca732F`, Pyth `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21`.

### Operator & integration docs

- [Error catalog](docs/ERROR_CATALOG.md) — custom errors: meaning, typical cause, suggested fix for integrators.
- [Deployment & ops runbook](docs/DEPLOYMENT_AND_OPS.md) — versioned addresses, roles, upgrades, pause/breaker playbooks, stale-oracle triage.

### REST Endpoints
Base URL: `http://localhost:3001` (or your backend host)

#### Protocol Stats & General
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/markets` | List markets (database indexer + Pyth/CoinGecko) |
| GET | `/api/stats` | Protocol stats (volume, OI, liquidations) |
| GET | `/api/leaderboard?limit=10&timeframe=all` | Leaderboard by volume |
| GET | `/api/insurance/claims?limit=20` | Bad debt claims |

#### User Interactions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user/:address/positions` | User open positions |
| GET | `/api/user/:address/trades?limit=20` | User trade history |

### Security Measures
- **Modular Core Components**: Separated to limit exploit ranges
- **Smart Contract Fixes**: Solvency fixes (PnL inversions) and atomic order execution validated.
- **Insurance Fund**: Staking mechanism implemented to backstop bad debt and prevent under-collateralized insolvency.

### Known Security Considerations
- Testnet Oracle feeds might be delayed; on mainnet, Pyth guarantees faster price actions.

### Current Limitations
- database indexer sync lag can intermittently cause out-of-date balances on portfolio page.

### Phase 1 (Hackathon) ✅
- [x] Core functionality implementation
- [x] Basic UI/UX
- [x] Smart contract deployment
- [x] Demo preparation
- [x] PostgreSQL Indexer setup
- [x] Cross-asset oracle price feeds

### Phase 2 (Post-Hackathon)
- [ ] Enhanced user interface
- [ ] Security audit (Mainnet ready)
- [ ] Mainnet deployment
- [ ] Multi-collateral integration

---

## Technical Details

### Environment Variables

**Root (contracts)**
| Variable | Required | Description |
|----------|----------|-------------|
| PRIVATE_KEY | Yes (deploy) | Deployer private key (no 0x) |
| CONFLUX_RPC_URL | No | Conflux eSpace mainnet RPC endpoint |
| CONFLUX_TESTNET_RPC_URL | Yes | RPC endpoint |
| CONFLUXSCAN_API_KEY | No | For contract verification |
| USDC_ADDRESS | No | USDC contract address |

**Backend**
| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | HTTP server port |
| WS_PORT | 3002 | WebSocket server port |
| ENABLE_WS | true | Set `false` on Vercel (polling mode) |
| ENABLE_ACTIVE_MARKETS_FILTER | true | Set `false` on Vercel to avoid RPC-heavy filtering |
| ENABLE_PYTH_24H | true | Set `false` on Vercel to avoid expensive per-market history calls |
| POSTGRES_URL | (see .env.example) | PostgreSQL connection URL |
| CHAIN_ID | 71 | Chain ID |
| RPC_URL | - | For on-chain market filter |
| RPC_FALLBACK_URL | - | Fallback RPC when primary fails |
| TRADING_CORE_ADDRESS | - | TradingCore contract |
| ORACLE_AGGREGATOR_ADDRESS | - | OracleAggregator contract |
| CRON_SECRET | - | Optional bearer token for `/api/sync` |
| NODE_ENV | development | Environment |
| METRICS_PORT | 9090 | Metrics endpoint config |

**Frontend**
| Variable | Default | Description |
|----------|---------|-------------|
| VITE_API_URL | http://localhost:3001/api | Backend API base |
| VITE_WS_URL | (empty) | Optional; keep empty on Vercel |
| VITE_CHAIN_ID | 71 | Chain id for wallet/network checks |
| VITE_RPC_URL | https://evmtestnet.confluxrpc.com | Primary RPC for wallet/client |
| VITE_CONFLUX_TESTNET_RPC_URL | https://evmtestnet.confluxrpc.com | Explicit testnet RPC |
| VITE_APP_URL | - | Optional app base URL (WalletConnect metadata) |
| VITE_WALLET_CONNECT_PROJECT_ID | - | **Required** for WalletConnect |
| VITE_TRADING_CORE_ADDRESS | - | **Required** for trading |
| VITE_VAULT_CORE_ADDRESS | - | **Required** for vault |
| VITE_ORACLE_AGGREGATOR_ADDRESS | - | **Required** for prices |
| VITE_POSITION_TOKEN_ADDRESS | - | **Required** for positions |
| VITE_MOCK_USDC_ADDRESS | - | Mock USDC on testnet |
| VITE_MOCK_MODE | false | Toggle mock-mode UI behavior |

---

### Docker
**Prerequisite:** Ensure Docker Desktop (or Docker Engine) is running before building/starting.

#### Minimal (backend + frontend)
```bash
docker compose -f docker-compose.minimal.yml up -d
```
- Frontend: http://localhost:3000 (API and WebSocket proxied via nginx)
- Backend API: http://localhost:3001
- WebSocket: ws://localhost:3002


### Deploy on Vercel
You can run the full app (frontend + API) on a single Vercel project in **REST polling mode**. The backend runs as serverless functions; native Node WebSocket server is disabled in this mode.

1. Import your Git repository via Vercel.
2. Leave **Root Directory** empty.
3. Add Environment Variables via Settings:
   - `VITE_API_URL=/api`
   - `VITE_WS_URL=` (empty)
   - `ENABLE_WS=false`
   - `ENABLE_ACTIVE_MARKETS_FILTER=false`
   - `ENABLE_PYTH_24H=false`
   - `POSTGRES_URL=<your neon pooled url with sslmode=require>`
4. Deploy! Vercel runs the root `build` script (`build-vercel.mjs`), builds backend/frontend artifacts, rewrites `/api/*` to `api/index.ts`, and serves frontend assets from `public`.

### Troubleshooting
| Issue | Solution |
|-------|----------|
| **Markets not loading** | Check `POSTGRES_URL` and backend logs. Ensure PostgreSQL indexer is synced. |
| **Prices show 0** | Verify `RPC_URL`, `TRADING_CORE_ADDRESS`. Pyth/CoinGecko may be rate-limited. |
| **Mint Mock USDC fails** | Confirm `VITE_MOCK_USDC_ADDRESS` matches `deployment/confluxTestnet.json`. Connect to Conflux eSpace Testnet. |
| **WalletConnect not connecting** | Set `VITE_WALLET_CONNECT_PROJECT_ID` from cloud.walletconnect.com. |
| **Backend 404** | Ensure routes use `/api` prefix. Frontend should use `VITE_API_URL=http://localhost:3001/api`. |

### Development Process
- Detailed component organization (contracts, backend, frontend, database indexer).
- Commit with conventional messages.
- More docs:
  - [backend/README.md](backend/README.md) — Backend API details
  - [frontend/README.md](frontend/README.md) — Frontend runtime/build/env details
  - PostgreSQL Database Schema
  - [infrastructure/README.md](infrastructure/README.md) — Kubernetes & monitoring

### Code Style
- Follow established conventions
- Prettier on contracts and TS code
- Strict mode TypeScript configurations utilized

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Conflux Hackathon
- **Conflux Network** - For hosting the hackathon and providing the platform
- **Conflux Team** - For technical support and mentorship
- **Community** - For feedback and encouragement

### Support
- **Issues**: [GitHub Issues](https://github.com/AmirMP12/realyx-perp-dex/issues)

---

**Built with ❤️ for Global Hackfest 2026**

*Thank you for checking out our project! We hope it contributes to the growth and innovation of the Conflux ecosystem.*
