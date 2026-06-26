# Architecture Overview

Realyx is fundamentally designed as a scalable, decentralized **Perpetual DEX** operating natively on **Conflux eSpace**. It is heavily optimized for Real-World Asset (RWA) and Crypto futures, delivering robust leverage trading with institutional-grade latency.

---

## 🧩 Core On-Chain Components (Solidity)

The protocol implements a highly modular smart contract architecture to ensure maximum scalability, upgradeability, and security:

### 1. `TradingCore`
The central nervous system for traders. 
- Handles the creation, validation, and execution of limit and market orders.
- Interfaces with keepers to execute asynchronous trades natively on-chain.
- Manages the lifecycle of user positions including collateral checks.

### 2. `VaultCore`
The protocol's liquidity engine. 
- Serves as the universal counterparty to all trader PnL.
- Manages Liquidity Provider (LP) deposits, share issuance, and withdrawal queues.
- Hosts the **insurance tranche** as a separate share class *inside the same contract* (`stakeInsurance` / `unstakeInsurance`) — a dedicated slice of capital that backstops bad debt before the main LP pool is touched. There is no standalone `InsuranceFund` contract.
- Tracks referral rebates accrued from fees (`claimableRebates`).

### 3. `OracleAggregator`
The deterministic pricing router.
- Integrates seamlessly with the **Pyth Network** via a pull-based oracle mechanism (primary source).
- Validates price freshness, confidence intervals, and circuit breakers, with TWAP buffering and emergency-price governance paths.
- Can optionally cross-check the primary feed against **one** secondary `IPriceSource` (the `RedStoneAdapter` module) with a deviation guard, so a single faulty feed cannot move markets unchecked.

### 4. `PositionToken` (ERC-721)
A unique NFT representation of leveraged positions.
- Each open trade mints a fully transferable, composable `PositionToken` NFT mapping your margin.
- Enables future capabilities like secondary markets for positions or composable DeFi integrations.

### 5. Supporting contracts
- **`TradingCoreViews`** — read-only companion for gas-efficient view queries.
- **`MarketCalendar`** — enforces trading-hours for RWA (equity/commodity) markets; orders revert with `MarketClosed` outside session hours.
- **`DividendManager`** + **`DividendKeeper`** — settle dividend-style corporate-action adjustments for tokenized equity positions.
- **`CollateralRegistry`** — registers alternative collateral tokens with per-asset haircuts and exposure caps.
- **`CopyRegistry`** — on-chain registry powering copy-trading (lead traders ↔ copiers).
- **`ReferralRegistry`** — referral codes that route fee rebates to referrers.
- **`AllowListCompliance`** (`IComplianceManager`) — optional per-market access gating consulted by `TradingCore.createOrder`.

---

## 📁 Smart Contract Structure (`contracts/`)

The Solidity codebase is organized into clear functional layers — deployable cores, their interfaces, stateless math/logic libraries, optional pluggable modules, and a test harness/mock suite.

```text
contracts/
├── base/
│   └── AccessControlled.sol                 # Shared role/admin access-control base
├── core/                                    # Deployable, upgradeable core contracts
│   ├── TradingCore.sol                      # Order creation, execution, funding, liquidation
│   ├── TradingCoreViews.sol                 # Gas-efficient read/view companion
│   ├── VaultCore.sol                        # LP liquidity, insurance tranche, borrow/repay, rebates
│   ├── OracleAggregator.sol                 # Pyth feeds, staleness/confidence checks, circuit breakers
│   ├── PositionToken.sol                    # ERC-721 position NFT
│   ├── MarketCalendar.sol                   # RWA trading-hours enforcement
│   ├── DividendManager.sol                  # RWA corporate-action (dividend) settlement
│   ├── CollateralRegistry.sol               # Multi-collateral registry (haircuts, exposure caps)
│   ├── CopyRegistry.sol                     # Copy-trading registry (leads ↔ copiers)
│   └── ReferralRegistry.sol                 # Referral codes / fee rebates
├── interfaces/                              # External-facing contract interfaces
│   ├── IComplianceManager.sol
│   ├── ICopyRegistry.sol
│   ├── IDividendManager.sol
│   ├── IMarketCalendar.sol
│   ├── IOracleAggregator.sol
│   ├── IPositionToken.sol
│   ├── IPriceSource.sol
│   ├── IReferralRegistry.sol
│   ├── ITradingCore.sol
│   └── IVaultCore.sol
├── libraries/                               # Stateless math & logic libraries
│   ├── DataTypes.sol                        # Shared structs/constants (FUNDING_INTERVAL, params, …)
│   ├── Events.sol                           # Shared event definitions
│   ├── ConfigLib.sol                        # Protocol configuration helpers
│   ├── TradingLib.sol                       # Core trading logic
│   ├── TradingContextLib.sol                # Trade execution context assembly
│   ├── PositionMath.sol                     # Position sizing / PnL math
│   ├── PositionCloseLib.sol                 # Position close accounting
│   ├── PositionTriggersLib.sol              # TP / SL / trailing-stop logic
│   ├── FeeCalculator.sol                    # Borrow / trading fee computation
│   ├── FundingLib.sol                       # Funding-rate accrual & settlement
│   ├── HealthLib.sol                        # Position/account health factors
│   ├── LiquidationLib.sol                   # Liquidation eligibility & rewards
│   ├── PortfolioRiskLib.sol                 # Cross-margin account risk snapshots
│   ├── GlobalPnLLib.sol                     # Protocol-wide PnL aggregation
│   ├── CollateralRouterLib.sol              # Multi-collateral routing
│   ├── WithdrawLib.sol                      # Vault withdrawal queue logic
│   ├── DividendSettlementLib.sol            # Dividend settlement math
│   ├── OracleAggregatorLib.sol              # Oracle aggregation helpers
│   ├── EmergencyPriceLib.sol                # Emergency-price governance path
│   ├── EmergencyPauseLib.sol                # Emergency pause controls
│   ├── CircuitBreakerLib.sol                # Oracle circuit-breaker logic
│   ├── RateLimitLib.sol                     # Rate limiting
│   ├── FlashLoanCheck.sol                   # Flash-loan / same-block guards
│   ├── MonitoringLib.sol                    # On-chain monitoring helpers
│   ├── CleanupLib.sol                       # State cleanup utilities
│   └── DustLib.sol                          # Dust handling
├── modules/                                 # Optional pluggable modules
│   ├── AllowListCompliance.sol              # IComplianceManager allow-list gating
│   ├── DividendKeeper.sol                   # Dividend settlement keeper
│   └── RedStoneAdapter.sol                  # RedStone price-source adapter
└── test/                                    # Test harnesses & mocks (not deployed)
    ├── *Harness.sol                         # Library/coverage harnesses
    └── Mock*.sol                            # Mock tokens, oracles, vault/core stubs
```

> Core contracts are UUPS-upgradeable and deployed via `scripts/deploy.ts`; libraries are linked at compile time, and `interfaces/` define the cross-contract call surface. The `test/` directory holds Hardhat-only harnesses and mocks and is excluded from production deployment.

---

## Off-Chain Infrastructure

### 1. Backend Services (Node.js & Express)
The backend layer serves as the high-throughput bridge connecting the UI to Conflux.
- Exposes REST endpoints and optional WebSocket broadcasts.
- In serverless mode, realtime data is served via frontend polling (`VITE_WS_URL` left empty).
- Aggregates indexed PostgreSQL data with Pyth/fallback market data source values for frontend consumption.

### 2. Indexing Layer (PostgreSQL Event Indexer)
PostgreSQL tables index execution events emitted by the contracts.
- Powers granular historic queries.
- Computes advanced leaderboard metrics, cumulative user volume, and protocol TVL—computations too expensive to execute natively via RPC.

---

## 🚀 Performance & Scalability

Realyx utilizes a multi-tier data delivery architecture designed to handle high-frequency interactions while minimizing RPC load:

### 1. Unified Backend Cache
The Express backend implements a server-side caching layer for global protocol metrics (TVL, 24h Volume, Open Interest). This ensures that heavy database aggregations and slow on-chain `totalAssets()` calls do not block the UI during periods of high traffic.

### 2. Intelligent Frontend Revalidation (Tanstack Query)
The React frontend utilizes **Tanstack Query** (formerly React Query) for state management. 
- **Graceful Staling**: Components render instantly from local cache while fresh data is fetched in the background.
- **Atomic Refetching**: Prevents "over-fetching" by deduplicating concurrent requests to the same endpoint across different UI components.

### 3. Serverless Compatibility & Polling Fallback
Designed to run anywhere, the protocol supports serverless deployments.
- **REST Priority**: Since native WebSockets are natively restricted in serverless environments, the frontend automatically falls back to an ultra-lightweight REST polling mechanism.
- **Dynamic Intervals**: Polling frequency is dynamically adjusted based on tab focus and user interaction to optimize resource consumption.

---

## 🔄 System Flow

### Trade Execution Lifecycle
Realyx executes orders atomically while isolating risk via asynchronous keepers:
1. **Order Creation**: User submits a `createOrder` payload to `TradingCore` with attached CFX/USDT0 collateral.
2. **Keeper Detection**: Decentralized keeper nodes detect the emitted `OrderCreated` event.
3. **Execution**: Keepers validate off-chain state and execute the order via `executeOrder`, injecting the latest Pyth oracle blob.
4. **Settlement**: `TradingCore` verifies the oracle blob, updates the position token, and realizes exposure against `VaultCore`.

### Oracle Integration
By utilizing **Pyth Network's pull-based logic**, Realyx eliminates continuous on-chain gas costs. Prices are updated deterministically only at the exact block they are required for execution or liquidation.

---

## 🔒 Security Posture

- **Circuit Breakers**: `OracleAggregator` halts market execution automatically if oracle freshness or confidence intervals deteriorate.
- **Insurance Tranche**: A dedicated share class inside `VaultCore` is staked explicitly to cover bad debt during flash crashes, before the main LP pool is affected.
- **Cross-Margin Risk Engine**: `TradingCore` runs cross-margin by default (`crossMarginByDefault = true`) with account-level risk snapshots (`getAccountRisk`, `canLiquidateAccount`).
- **Compliance Gating**: When an `IComplianceManager` is wired in, `createOrder` enforces `checkCompliance(market)`.
- **Upgrade Governance**: Core contracts are UUPS-upgradeable; `_authorizeUpgrade` is admin-gated and intended to sit behind a multisig with an off-chain hold. Sensitive parameter changes use 48h timelocks.
