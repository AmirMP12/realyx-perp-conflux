# 🌌 Realyx — RWA Perpetual Futures DEX

Bridging TradFi and DeFi on Conflux eSpace: Trade Crypto, Equities, and Commodities with up to 100x leverage. Non-custodial, zero KYC, lightning fast.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Conflux](https://img.shields.io/badge/built%20on-Conflux-blue)](https://confluxnetwork.org)
[![Hackathon](https://img.shields.io/badge/Global%20Hackfest%202026-green)](https://github.com/conflux-fans/global-hackfest-2026)

</div>

---

## 📖 Overview
Realyx is a decentralized, intent-based perpetual futures exchange natively built on the Conflux eSpace network. It democratizes access to global financial markets by allowing users to permissionlessly trade high-demand **Real World Assets (RWAs)**—such as Nvidia, Tesla, and Gold commodities—alongside tier-1 cryptocurrencies from a unified margin account. 

Unlike traditional Automated Market Makers (AMMs) that suffer from high slippage and impermanent loss, Realyx utilizes an optimized **Shared Liquidity Vault** backed by stablecoins acting as a universal counterparty. Through the strategic integration of asynchronous order routing, decentralized Keeper execution nodes, and ultra-low latency infrastructure from the **Pyth Network**, we bring the high-frequency trading capabilities of centralized exchanges directly to the EVM layer while ensuring users maintain absolute custody of their funds.

---

## 🏆 Hackathon Information
- **Event**: Global Hackfest 2026
- **Team**: Realyx 

---

## 👥 Team
| Name | Role | GitHub |
|------|------|--------|
| Amir | Full-Stack/Contract Developer | [@AmirMP12](https://github.com/AmirMP12) |

---

## 🚀 Problem Statement
**What problem does Realyx solve?**

Financial globalization is severely fragmented. Centralized platforms gatekeep access to global equities and commodities through strict geographical barriers, steep account minimums, and protracted KYC hurdles. Conversely, decentralized finance (DeFi) platforms have historically been restricted to synthetic crypto assets due to the technical limitations of EVM oracle latency and extreme vulnerability to front-running.

**Deep Dive into the Friction Points:**
1. **Siloed Liquidity & UX:** A retail trader wanting to long Tesla equity and short Bitcoin cannot do so from a unified Web3 portfolio. They must use TradFi brokers (subject to business hours) and disjointed DeFi DEXs simultaneously.
2. **Custodial Risk Execution:** To achieve low-latency perpetual trading, most platforms force users to deposit funds into centralized custodial or off-chain Layer-2 sequencers, completely breaking the fundamental ethos of Web3.
3. **Impermanent Loss & AMM Inefficiency:** Native on-chain derivatives historically rely on basic x*y=k liquidity pools, subjecting liquidity providers (LPs) to catastrophic impermanent loss when price structures diverge rapidly.

**How Conflux Blockchain helps:** 
By deploying on Conflux eSpace, an EVM-compatible network capable of high parallel throughput and fraction-of-a-cent gas fees, Realyx can deploy complex zero-slippage pricing models directly parameterized by external Pyth oracles. The blockchain ensures algorithmic transparency, cryptographically preventing internal exchange manipulation or arbitrary user liquidation blockages.

---

## 💡 Solution
**How does Realyx address the problem?**

Realyx introduces a **Synthetic Vault Counterparty** architecture merged with an intent-based execution engine.

**1. The `realyxLP` Vault Mechanics:**
Instead of pairing traders against each other (which requires deep orderbooks) or using volatile AMMs, Realyx requires Liquidity Providers (LPs) to stake stablecoins (USDT0/AxCNH/USDT/USDC, with USDT0 as the main settlement collateral) into `VaultCore.sol`. The Vault collectively acts as the counterparty to all trader open interest. If traders lose, the Vault gains value; if traders win, the Vault pays out. LPs are heavily compensated via standard borrow fees, funding rates, and protocol volume taxes.

**2. Asynchronous MEV-Resistant Execution:**
When a trader submits an order on Realyx, they are technically submitting a cryptographically signed "intent." 
- `createOrder` locks collateral.
- A decentralized bot/Keeper listens to the Conflux blockchain for the intent.
- The Keeper independently fetches the absolutely newest Pyth Oracle signed pricing data, updating the on-chain oracle and executing the intent in the exact same atomic transaction via `executeOrder`. 
**Result:** No front-running. No stale-price arbitrage.

**3. Safety via Insurance Backstop:**
In the rare event of extreme, catastrophic market volatility causing PnL inversions (where trader profits massively exceed available Vault liquidity), Realyx employs a staked Insurance backstop that absorbs bad debt prior to the core LP Vault being struck. The insurance pool is not a separate contract — it is a dedicated share class inside `VaultCore.sol` (`stakeInsurance` / `unstakeInsurance`), so backstop capital and LP capital share the same audited accounting surface.

---

## 📈 Go-to-Market Plan
- **Primary Audience:** DeFi power users seeking decentralized exposure to TradFi assets (AAPL, TSLA, GLD) and passive Yield Farmers wanting sustainable real yield derived from trader open-interest fees rather than inflationary tokenomics.
- **Acquisition & Bootstrap Strategy:** 
  1. Bootstrapping initial liquidity by offering 100% of generated platform revenue directly to early `realyxLP` Vault depositors for the first 6 months.
  2. Launching gamified trading competitions and volume leaderboards directly on Conflux testnet, converting those power users seamlessly immediately upon mainnet deployment.
- **Key Performance Indicators (Bootstrap Phase KPIs):** 
  - **Initial TVL Target:** > $350,000 in stablecoin Vault liquidity (sufficient to safely collateralize up to $3.5M in global Open Interest given 10x leverage dynamics).
  - **Daily Exchange Volume:** > $1,000,000 generated through initial retail onboarding and automated arbitrage volume.
  - **Open Interest Retention:** > 60% weekly retention rate among early protocol adopters.
  - **User Acquisition:** Securing 300+ active beta wallets within the first 30 days of mainnet.
- **Ecosystem Synergy:** Realyx establishes a critical DeFi primitive for Conflux eSpace. Perpetual DEX protocols generate the highest consistent contract interactions and block space utilization, creating massive baseline health and velocity for the broader Conflux ecosystem native stables.

---

## ⚡ Conflux Integration
**How does Realyx leverage Conflux features?**

- [x] **eSpace** - All core smart contracts (`TradingCore`, `VaultCore`, `OracleAggregator`, `PositionToken`, plus the RWA/social modules) are natively deployed and optimized for Conflux eSpace to leverage EVM compatibility. By deploying on eSpace, Realyx supports MetaMask/Fluent wallets and full Hardhat testability.
- [x] **Pyth Network** - Native integration with Pyth Network’s pull-based oracle system. This allows the protocol to update prices sub-second directly during trade execution blocks, securing Realyx against front-running and ensuring our index prices mirror Binance/Nasdaq flawlessly.
- [x] **Other** - Built robustly with a custom native PostgreSQL EVM Web3 Indexer running on an Express Node.js backbone. The indexer strictly listens to Conflux eSpace `blocks` and `logs` to populate our SQL environment in real-time.

---

## 🌟 Feature Capabilities

### Core Features
- **NFT Position Tokenization (Transferable Trades):** In a massive leap for DeFi composability, Realyx wraps every open leveraged trade into an official ERC-721 NFT (`PositionToken.sol`). This allows traders to seamlessly transfer, gift, or recursively collateralize their active perpetual positions across standard Web3 ecosystems exactly as they would any standard NFT infrastructure!
- **Advanced Vault Core System:** A highly resilient share-based accounting mechanism (`VaultCore.sol`). When LPs deposit stablecoins, they dynamically mint `realyxLP` utility tokens. These tokens represent fractional ownership of the entire Vault's collateral pool, structurally guaranteed to track intrinsic protocol profit accrued from trader liquidations, borrow fees, and swap expenses over time.
- **Insurance Backstop (share class within the Vault):** Built to absorb systemic tail-risk events. If traders experience immense, catastrophic PnL inversions (e.g. flash-crashes) that would otherwise drain the main liquidity pool, the staked insurance tranche inside `VaultCore` automatically shoulders the bad debt first. Insurance stakers (`stakeInsurance` / `unstakeInsurance`) earn premium yield in exchange for acting as the protocol's first line of systemic defense.
- **Cross-Margin by Default:** `TradingCore` runs a cross-margin engine (`crossMarginByDefault = true`) with account-level risk snapshots (`getAccountRisk`, `canLiquidateAccount`), so a trader's whole collateral balance offsets risk across their open positions.
- **Global Markets Access:** Trade Crypto (CFX, BTC, ETH), tokenized Equities (NVDAX, TSLAX, AAPLX, METAX, GOOGLX, NFLXX, MCDX, HOODX, MSTRX, SPYX) and crypto-adjacent equities (COINX, CRCLX), plus Commodities (XAUT/Gold) seamlessly across one decentralized interface.
- **Dynamic Funding Rates:** Math-driven funding accrues continuously and settles on an **8-hour** interval (`DataTypes.FUNDING_INTERVAL = 8 hours`) to balance long and short skewed demand organically.

### Advanced Features
- **Copy Trading:** Lead traders register on `CopyRegistry`; followers mirror their intent flow with per-relationship allocation and leverage caps, surfaced through the in-app Copy Trading and Trader Profile pages.
- **Referrals & Rebates:** On-chain referral codes (`ReferralRegistry`) route a share of fees back to referrers as claimable USDT0 rebates (`VaultCore.claimableRebates`).
- **RWA Corporate Actions:** `DividendManager` + `DividendKeeper` settle dividend-style adjustments for tokenized equity positions, while `MarketCalendar` enforces trading-hours for RWA markets (orders revert with `MarketClosed` outside session hours).
- **Compliance Hooks:** An optional `IComplianceManager` (e.g. `AllowListCompliance`) can gate markets; `createOrder` enforces `checkCompliance(market)` when a compliance manager is wired in.
- **Multi-Collateral Ready:** `CollateralRegistry` supports registering alternative collaterals (e.g. USDC, AxCNH) with per-asset haircuts and exposure caps.
- **Strict Security Parameters:** Hyper-strict max slippage bounding, configurable max leverage / position-size / exposure caps, and Keeper-validated Pyth timestamps overriding stale oracle reads.
- **Dynamic Liquidation Engine:** Configurable maintenance/initial margin thresholds ensuring vault solvency continuously.
- **Interactive Analytics:** Real-time charting via TradingView Lightweight Charts, TVL/volume history curves, and Top Trader Leaderboards based on PnL mapping.
- **Live Triggers Mechanism:** Set-and-forget Take-Profit (TP), Stop-Loss (SL), and Trailing Stop bounds integrated at the smart-contract level (`setTakeProfit`, `setStopLoss`, `setTrailingStop`).
- **Funding Competitiveness:** The trade ticket compares Realyx's on-chain 8h funding against the equivalent Binance perp (annualized, with a fairness verdict) so traders can verify funding is fair, not just assert it.
- **LP Real-Yield Transparency:** The Vault page surfaces APR broken down by source (borrow/trading fees, funding flow, liquidation proceeds) with a 30d APR history curve (`/api/vault/yield`) — proving the yield is trader-driven, not inflationary emissions.
- **Public Status Page:** A `/status` page (backed by `/api/status`) reports live oracle/RPC/indexer health, uptime, vault solvency ratio, and insurance-fund size — leaders compete on transparency.
- **Installable PWA + Off-App Alerts:** Realyx ships a web manifest and service worker, so it installs to the home screen and delivers background push/system notifications for liquidation warnings and TP/SL fills.

### Future Features (Roadmap)
- **Additional Native Collaterals** - Deepen `CollateralRegistry` integration to accept more Conflux-native stable/bridge utilities (USDC/AxCNH) as live underlying collateral.
- **Decentralized Keeper Network** - Open permissionless keeper participation with on-chain bounty distribution.
- **Third-Party Security Audit & Mainnet** - Full audit ahead of Conflux eSpace mainnet launch.

---

## 🛠️ Technology Architecture

### Stack Elements
- **Frontend**: React 18, Vite, Tailwind CSS, Zustand (state), TanStack Query (data), Framer Motion, Wagmi, Viem, RainbowKit, TradingView Lightweight Charts, Lucide-React.
- **Backend**: Node.js + Express + TypeScript, `pino` logging, `ws` WebSockets, Prometheus metrics.
- **Database Indexing**: PostgreSQL 16 mapped via `pg` to EVM `getLogs` polling routines.
- **Contracts**: Solidity 0.8.24, OpenZeppelin (upgradeable), UUPS proxies, Pyth pull oracle, Hardhat + TypeChain.
- **SDK**: `@realyx/sdk` — TypeScript strategy SDK (REST + WebSocket + ethers v6 order builder) in `sdk/`.
- **Network**: Conflux eSpace Testnet (chain id 71); Mainnet (1030) planned.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/Vite)                           │
│  Markets · Trade · Portfolio · Vault · Insurance · Leaderboard ·             │
│  Copy Trading · Referrals · Analytics · Status · Settings · PWA              │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ REST API / WebSocket (polling mode)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Express Node)                          │
│  Event Indexer | Market Aggregator | Stats | Leaderboard | Copy Engine       │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ SQL + RPC ABI Interactions
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│ NATIVE INDEXER  │           │  PYTH NETWORK   │           │ KEEPER NODES     │
│  (PostgreSQL)   │           │  (Hermes API)   │           │ (keeper-bot.ts)  │
│ Persists State  │           │ Signed Prices   │           │ Executes Intents │
└────────┬────────┘           └─────────────────┘           └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CHAIN (Conflux eSpace Testnet · 71)                     │
│  TradingCore · TradingCoreViews · VaultCore · OracleAggregator ·             │
│  PositionToken · MarketCalendar · DividendManager · ComplianceManager ·      │
│  DividendKeeper · CollateralRegistry · CopyRegistry · ReferralRegistry       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites
Before you begin, ensure you have the following installed:

- **Node.js** (v18.0.0 or higher) - Runtime execution.
- **Git** - Version control handling.
- **Conflux Wallet** ([Fluent Wallet](https://fluentwallet.com/) or [MetaMask](https://metamask.io/) configured for eSpace connection).
- **Docker** - For completely containerizing the backend PostGres & Redis configurations instantly.

---

## 📦 Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/AmirMP12/realyx-perp-conflux.git
cd realyx-perp-conflux
```

### 2. Install Sub-Workspace Dependencies
We utilize npm workspaces for monorepo efficiency.
```bash
npm install
npm install --workspace backend
npm install --workspace frontend
```

### 3. Environment & Secrets Configuration
You must configure your `.env` variables cleanly!
```bash
# Core root deployment variables (For Hardhat)
cp .env.example .env

# Backend runtime environment
cp backend/.env.example backend/.env

# Frontend API mappings
cp frontend/.env.example frontend/.env
```
Inside your `frontend/.env`, ensure WalletConnect IDs and smart contract addresses match the newly deployed states:
```env
# Example Testnet Configs
VITE_API_URL=http://localhost:3001/api
VITE_RPC_URL=https://evmtestnet.confluxrpc.com
VITE_TRADING_CORE_ADDRESS=0xc8A6585dFBe2833ed093E557D36DC8Fe136a8c76
VITE_CHAIN_ID=71
```

### 4. Smart Contract Deployment Simulation
```bash
# Compile contracts utilizing Solidity 0.8.24
npm run compile

# Target deployment towards Conflux eSpace testnet
npm run deploy:conflux-testnet

# Optionally verify contracts against ConfluxScan
npm run verify:conflux-testnet
```

### 5. Start Full Development Environment
We highly recommend running the backend stack purely through our minimal Docker compose to ignore manual Postgres tooling installs.
```bash
# Start Dockerized application instantly (Spin up API, Frontend, Database, Indexer)
docker-compose -f docker-compose.minimal.yml up -d
```
The React frontend should now be hot bound running robustly at `http://localhost:3000`.

---

## 🧪 Testing and Validations
Run comprehensive component tests across all layers of the stack:

```bash
# Execute deeply integrated hardhat smart contract test scenarios
npm run test

# Run backend event ingestion logic testing and REST API verification
cd backend && npm test

# Run frontend UI component mounting lifecycle testing
cd frontend && npm test
```

### Test Coverage Reporting
To generate code-level coverage graphs highlighting edge case penetrations via istanbul:
```bash
npx hardhat coverage
```

---

## 🎮 Getting Started Workflows

### 1. Account Initialization setup
- Open the application locally or navigate to the hosted demo link.
- Click the glowing primary **Connect Wallet** button on the top right header.
- Select your primary wallet (MetaMask) and physically ensure your RPC is mapped to `Conflux eSpace Testnet (Network ID: 71)`.
- If you lack native `$CFX`, utilize the [Conflux eSpace testnet faucet](https://efaucet.confluxnetwork.org/).

### 2. Minting Testnet Portfolio Collateral
Realyx operates totally independent of AMMs relying on standard USDT0 balances. 
- Click the **Settings Gear** navigation element.
- Enter the **Testnet Tools** view.
- Click **"Mint 1k Mock USDT0"** and sign the incoming wallet action.

---

## 🌊 Example Operational Workflows

#### Workflow 1: Committing a Margin Long Trading Intent
```text
1. Select the "Markets" left-navigation panel and parse the Crypto List for "CFX/USD".
2. On the trade view, select the "Long" toggle.
3. Input 100 USDT0 in the strictly validated Collateral field.
4. Drag the visual slider to format the Margin Multiplier to max (10.0x Leverage).
   -> Note: Observe the Order Notional Size visually scale to exactly 1000 USDT0.
5. Click "Submit Long Order CFX".
6. Your wallet will prompt an asynchronous transaction ensuring your 100 USDT0 is committed to the Vault securely.
7. Within ~3 seconds, observe the "Positions" table at the bottom of the interface instantly refresh tracking your Live PnL mapped dynamically via Websockets!
```

#### Workflow 2: Depositing Vault Counterparty Liquidity
```text
1. Navigate directly to the 'Vault' navigation tab in the App Header.
2. Locate the comprehensive TVL and Profit charts for the master USDT0 Vault ecosystem.
3. Scroll to the "Deposit / Withdraw" action zone and enter 500 USDT0.
4. Finalize the "Deposit Liquidity" transaction payload.
5. You instantly mint representative shares of the `realyxLP` utility token to your account index tracking Vault profitability intrinsically.
```

---

## 📺 Demo Showcases

- **🌍 Live Conflux eSpace Hosted Demo:** [Realyx Platform](https://app.realyx.example/)
- **🎥 Official Walkthrough Demo:** [Watch the walkthrough](https://youtube.com)
- **⏱️ Duration:** [3 minutes]

---

## 📜 Complete Contract Documentation

### Conflux eSpace Deployed Identifiers (Testnet v1)
> Source of truth: [`deployment/confluxTestnet.json`](deployment/confluxTestnet.json) (chain id `71`). Verify on-chain before reuse.

| Contract | Role | Address |
|----------|------|---------|
| **TradingCore** | Order creation, execution, funding, liquidation | [`0xc8A6585dFBe2833ed093E557D36DC8Fe136a8c76`](https://evmtestnet.confluxscan.org/address/0xc8A6585dFBe2833ed093E557D36DC8Fe136a8c76) |
| **TradingCoreViews** | Gas-efficient read/view companion | [`0xb5c01fb09F2B9f62A4907dDB41c216419e79AbC5`](https://evmtestnet.confluxscan.org/address/0xb5c01fb09F2B9f62A4907dDB41c216419e79AbC5) |
| **VaultCore** | LP liquidity, insurance tranche, borrow/repay | [`0x98E011A8782aF36C5Ad6051bC54B86a7c0705F67`](https://evmtestnet.confluxscan.org/address/0x98E011A8782aF36C5Ad6051bC54B86a7c0705F67) |
| **OracleAggregator** | Pyth feeds, staleness checks, circuit breakers | [`0x9d027ab66F396176C188946cE49BA9061679e6a9`](https://evmtestnet.confluxscan.org/address/0x9d027ab66F396176C188946cE49BA9061679e6a9) |
| **PositionToken** | ERC-721 position NFT | [`0xF520CC4B305553A9b6D391571c303E45AacC178c`](https://evmtestnet.confluxscan.org/address/0xF520CC4B305553A9b6D391571c303E45AacC178c) |
| **MarketCalendar** | RWA trading-hours enforcement | [`0xDE6a4fa0e8DE4D3f0792010Fd49AbdeF8915529e`](https://evmtestnet.confluxscan.org/address/0xDE6a4fa0e8DE4D3f0792010Fd49AbdeF8915529e) |
| **DividendManager** | RWA corporate-action settlement | [`0xA84104C6E2Ed7455a606A3439aF80863112e9B0b`](https://evmtestnet.confluxscan.org/address/0xA84104C6E2Ed7455a606A3439aF80863112e9B0b) |
| **ComplianceManager** | Optional allow-list / market gating | [`0xD694F0BC86e1f24439037A221f7c4e3beDB781D7`](https://evmtestnet.confluxscan.org/address/0xD694F0BC86e1f24439037A221f7c4e3beDB781D7) |
| **DividendKeeper** | Dividend settlement keeper | [`0x5CCdb637C1Fa5D06D7F666BDBb62F3Ad12A58010`](https://evmtestnet.confluxscan.org/address/0x5CCdb637C1Fa5D06D7F666BDBb62F3Ad12A58010) |
| **CollateralRegistry** | Multi-collateral registry (haircuts, price feeds) | [`0x0f5cAC8a3BC4E61ABA1d547D9A2C1DFA5A087054`](https://evmtestnet.confluxscan.org/address/0x0f5cAC8a3BC4E61ABA1d547D9A2C1DFA5A087054) |
| **CopyRegistry** | Copy-trading lead/follower registry | [`0xf09b2fa210Fe2dbE17287B331E7A93c58Bb5A001`](https://evmtestnet.confluxscan.org/address/0xf09b2fa210Fe2dbE17287B331E7A93c58Bb5A001) |
| **ReferralRegistry** | Referral codes, discounts, rebates | [`0x5FbD3aBfBdB667e543B23B80f34Fa7167C1514a8`](https://evmtestnet.confluxscan.org/address/0x5FbD3aBfBdB667e543B23B80f34Fa7167C1514a8) |
| **Mock USDT0** | Testnet collateral (mintable in-app) | [`0x85B9BA60D6Aef728c0Ea9C9f6709D31707dfC73A`](https://evmtestnet.confluxscan.org/address/0x85B9BA60D6Aef728c0Ea9C9f6709D31707dfC73A) |
| **Pyth** | Pyth on-chain price contract | [`0xDd24F84d36BF92C65F92307595335bdFab5Bbd21`](https://evmtestnet.confluxscan.org/address/0xDd24F84d36BF92C65F92307595335bdFab5Bbd21) |

> `CopyRegistry`, `ReferralRegistry`, and `CollateralRegistry` are implemented and deployed by the deploy pipeline (`scripts/deploy.ts` → `scripts/write-deployment.ts`); their testnet addresses are published in `deployment/confluxTestnet.json`.

### Functional Protocol Interfaces

#### `ITradingCore.sol` Example
We structure core execution paths using a two-phase, intent-based flow. `createOrder` escrows collateral and queues a signed intent; a Keeper then executes it atomically against fresh Pyth data via `executeOrder`.

```solidity
interface ITradingCore {
    // Stage 1: Escrow collateral and queue a signed intent.
    // Advanced fields (TIF, brackets, iceberg/TWAP) live in CreateOrderParams.
    // Payable: forward the configured minimum execution fee as msg.value when required.
    function createOrder(DataTypes.CreateOrderParams calldata params)
        external
        payable
        returns (uint256 orderId);

    // Stage 2: Keeper executes a queued order with fresh oracle data.
    // priceUpdateData is the Pyth updatePriceFeeds payload (empty when not needed).
    function executeOrder(uint256 orderId, bytes[] calldata priceUpdateData) external payable;

    // Cancel a queued order and refund escrow.
    function cancelOrder(uint256 orderId) external;

    // On-chain trigger orders.
    function setStopLoss(uint256 positionId, uint256 stopLossPrice) external;
    function setTakeProfit(uint256 positionId, uint256 takeProfitPrice) external;
    function setTrailingStop(uint256 positionId, uint256 trailingStopBps) external;

    // Liquidate an underwater position; pays the caller a reward.
    function liquidatePosition(uint256 positionId) external returns (uint256 liquidatorReward);
}
```

---

## 🔌 API Ecosystem Breakdown

The Realyx Node indexer provisions ultra-high volume REST capabilities allowing power-users and institutional market makers to scrape and interact effectively.

### Core Data Delivery
#### Authentication:
The entire REST API remains strictly permissionless mirroring the ethos of the on-chain counterpart.

#### Representative Core Responses (GET `api/stats` Payload):
```json
{
  "success": true,
  "data": {
    "totalMarkets": 12,
    "volume24h": "1250000.000000",
    "cumulativeVolumeUsd": "4529000.000000",
    "totalOpenInterest": "850000.000000",
    "totalLiquidations": "4",
    "activeTraders24h": 127,
    "tvl": "350000.000000"
  }
}
```

#### Detailed Contract Data Maps
```bash
# Query master statistics (TVL, 24h volume, OI, liquidations, active traders)
GET    /api/stats

# Daily aggregated metric history
GET    /api/stats/history

# LP real-yield breakdown — APR by source (borrow/trading fees, funding,
# liquidations) + 30d APR history, normalized to live TVL.
GET    /api/vault/yield

# Public transparency feed — overall + per-component health (oracle, RPC,
# indexer, vault), uptime, and vault solvency / insurance-fund metrics.
GET    /api/status

# Fetch indexed + on-chain market parameters
GET    /api/markets

# Historical price series for a single market
GET    /api/markets/price-history/:marketId?days=7

# Track a user's open positions
GET    /api/user/:address/positions

# Pull a user's historical trades
GET    /api/user/:address/trades?limit=50

# Global trader rankings by Realized PnL / Volume
GET    /api/leaderboard?limit=10&timeframe=all

# Insurance / bad-debt claim events
GET    /api/insurance/claims?limit=20

# On-chain referral stats (code, referees, rebates) for an address
GET    /api/referrals/stats?address=0x...

# Pyth on-chain price refresh — pushes latest Hermes VAAs to on-chain Pyth
# for the given oracle collection addresses (optionally gated by CRON_SECRET).
GET    /api/pyth-refresh?markets=0xMarket1,0xMarket2

# Copy-trading social data (v1)
GET    /api/v1/social/top-traders
GET    /api/v1/social/trader/:address
GET    /api/v1/social/copier/:address/following

# Manual index sync trigger (optionally gated by CRON_SECRET)
GET    /api/sync
```

> Both legacy (`/api/...`) and versioned (`/api/v1/...`) prefixes are served. Authenticated/internal routes include `/api/v1/auth/key` (EIP-712 API-key issuance), `/api/v1/keeper/failure` (keeper webhook), and `/api/debug` (guarded in production). Health checks live outside `/api`: `GET /health` and `GET /health/detailed`.

### WebSocket Streaming
For high frequency interface adjustments, the backend pushes tick level sub-second differentials heavily via lightweight raw payloads across natively configured websocket buffers on Node `ws`.

```javascript
// Example Client Connection
const ws = new WebSocket('ws://localhost:3002');

ws.on('open', () => {
    // Optionally narrow the firehose to specific channels
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['prices', 'stats'] }));
});

ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    if (data.type === 'price_update') {
       // PnL components re-evaluate synchronously against active POS arrays.
       // The server envelope is { type, data, marketAddress }.
       updateInterfacePrices(data.data);
    }
});
```

---

## 🔒 Security Posture

### Preventative Security Measures
- **Two-Phase Commit Order Structure (Intents):** By stripping users' abilities to natively execute immediate AMM market swaps directly based on chain state, we unequivocally destroy all theoretical front-running, price slippage sandwiches, and flash loan attacks.
- **Oracle Slippage & Validation Logic:** Incoming Pyth execution payloads strictly validate timestamps, ensuring `block.timestamp` deviates favorably relative to strict contract constraints. Extremely stale updates explicitly revert the protocol blocking zero-day extraction hacks.
- **Parametric Constraints Constraints:** Smart contracts statically validate minimum colateralizations, positional ceilings, maximum leveraged multipliers (10x Base), and prevent execution routing that directly crosses hard liquidation ceilings (preventing immediate liquidations).
- **Health-Checked RPC Failover:** The backend routes every chain read through a pooled RPC layer with per-endpoint circuit breakers (closed/half-open/open) and exponential-backoff cooldowns, so a single degraded Conflux provider can't poison reads — it's tripped out automatically and recovered on a half-open trial.
- **Observability & Data-Quality Guards:** Prometheus metrics + Grafana dashboards cover indexer lag (blocks behind head), per-endpoint RPC error rate and circuit state, keeper execution latency, and WebSocket connection count, with alert rules on each. A periodic reconciliation job compares indexed open interest / TVL against authoritative on-chain reads and alerts on drift, catching silent indexer bugs before users see wrong numbers.

### Known Security Considerations
- Testnets natively inherently present RPC fragility specifically related to Pyth public Hermes network configurations leading to unexpected oracle latency. On mainnet architectures, Pyth provisions exclusive deployment networks guaranteeing aggressive price fluidity unhindered by public testnet noise.
- Realyx enforces administrative overrides for adding additional underlying RWA markets, configuring funding velocities systematically.

### Current Edge Case Limitations
- **Issue 1:** Indexing runs on a dedicated worker (`backend/src/worker.ts`) that writes to the primary Postgres, while the API serves reads from a replica (`POSTGRES_READ_URL`) — so a hot re-index never adds request latency. Ingestion is **reorg-aware**: each scanned height's canonical block hash is checkpointed, and on resume the indexer walks stored hashes back to the common ancestor, purges orphaned events, and re-ingests from the canonical chain. Every write is idempotent via a `(tx_hash, log_index)` unique guard, so overlapping pulses (cron, lazy-sync, redundant workers) can't double-count. A server-side cache plus TanStack Query revalidation and a REST polling fallback cover the residual serverless edge.
- **Issue 2:** RWA equity markets follow `MarketCalendar` session hours, so orders on those markets revert with `MarketClosed` outside trading hours by design.
- **Issue 3:** The protocol has not yet completed a third-party security audit; testnet only.

---

## 🛣️ Phased Roadmap

**Phase 1 (Hackathon Global HackFest 2026)** ✅
- [x] Initial design vectoring and complex mathematical derivation plotting for Vault structures.
- [x] Hardhat core smart contract implementation and aggressive local validations running 100+ tests natively.
- [x] Comprehensive Postgres indexer data digestion methodologies setup tracking 15+ complex EVM emit states.
- [x] WebUI implementation (Settings, Analytics, Trade logic execution frameworks) deployment formatting securely.

**Phase 2 (Post-Hackathon)**
- [ ] Tier-1 Full-Stack independent structural contract security auditing validations.
- [ ] Conflux eSpace Global Mainnet Launch provisioning targeting heavy early-adoptor liquidity mining.
- [ ] Multi-chain token integrations natively accepting standard stable utilities (USDC/AxCNH).

**Phase 3 (Future Scale)**
- [ ] Expand multi-collateral support (USDC/AxCNH) live via `CollateralRegistry`.
- [ ] Deepen Social Copy Trading automation and on-chain trader-profile metadata.
- [ ] Permissionless containerized Keeper network with on-chain execution bounties.

---

## 🤝 Open Contributions Ecosystem

We heavily encourage external analysis and open-source contributions to our execution stacks. Fork the repository, branch, and open a PR following the standard process below.

### Standard Development Process
1. Fork the baseline target application repository actively.
2. Initialize and deploy an isolated feature branch matrix (`git checkout -b feature/dynamic-vault-metrics`).
3. Commit validated alterations comprehensively documented (`git commit -m 'Added dynamic Vault UI elements'`).
4. Push heavily towards origin states (`git push origin feature/dynamic-vault-metrics`).
5. Open an official Pull Request!

---

## ⚖️ Operational Licensing

This system actively inherits the massive decentralization frameworks available openly via the core MIT License matrix formats globally. Evaluate the core [LICENSE](LICENSE) mapping specific derivations!

---

## 🙏 Gracious Acknowledgments

- **Conflux Global Hackfest Network Initiative** - For fundamentally hosting an incredible boundary-pushing event!
- **Conflux Foundation Stack Teams** - For extreme infrastructural support, explicit technical documentation structures parsing eSpace compatibilities, and high mentorship outputs.
- **Open-source Communities** - Your relentless bug testing flows massively helped!

### Supported Utilizing Frameworks
- **[Pyth Network]** - The core baseline defining next-generation latency mechanisms.
- **[Wagmi.sh / Viem.sh]** - React hooks natively making UI structural elements incredibly capable across raw TS logic.

---

## 📞 Connectivity & Support Vectors

- **Core Tracker Issues:** [GitHub Repository Bug Reporting Tracking](https://github.com/AmirMP12/realyx-perp-conflux/issues)
- **X (Twitter):** [@Realyx_Perp](https://x.com/Realyx_Perp)
- **Telegram Channel:** [t.me/Real_yx](https://t.me/Real_yx)
- **Telegram Community Group:** [t.me/realyx_perp](https://t.me/realyx_perp)
- **Primary Source Link:** [AmirMP12/realyx-perp-conflux Baseline](https://github.com/AmirMP12/realyx-perp-conflux)
- **Execution URL Environment:** [Realyx Network Live Configurations](https://app.realyx.example/)

---

  <b>Built relentlessly with ❤️ for Conflux Global Hackfest 2026</b><br/><br/>
  <i>Incredible technologies originate collectively. We deeply hope Realyx drives profound innovative utilities towards Conflux Network ecosystem scale formats indefinitely!</i>
</div>
