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
- Contains the **Insurance Fund**, a dedicated subset of liquidity designed to backstop extreme systemic risk.

### 3. `OracleAggregator`
The deterministic pricing router.
- Integrates seamlessly with the **Pyth Network** via a pull-based oracle mechanism.
- Validates price freshness, confidence intervals, and circuit breakers.

### 4. `PositionToken` (ERC-721)
A unique NFT representation of leveraged positions.
- Each open trade mints a soul-bound `PositionToken`.
- Enables future capabilities like secondary markets for paper trading or composable DeFi integrations.

---

## Off-Chain Infrastructure

### 1. Backend Services (Node.js & Express)
The backend layer serves as the high-throughput bridge connecting the UI to Conflux.
- Exposes REST endpoints and optional WebSocket broadcasts.
- In Vercel/serverless mode, realtime data is served via frontend polling (`VITE_WS_URL` left empty).
- Aggregates indexed PostgreSQL data with Pyth/CoinGecko derived values for frontend consumption.

### 2. Indexing Layer (PostgreSQL Event Indexer)
PostgreSQL tables index execution events emitted by the contracts.
- Powers granular historic queries.
- Computes advanced leaderboard metrics, cumulative user volume, and protocol TVL—computations too expensive to execute natively via RPC.

---

## 🔄 System Flow

### Trade Execution Lifecycle
Realyx executes orders atomically while isolating risk via asynchronous keepers:
1. **Order Creation**: User submits a `createOrder` payload to `TradingCore` with attached CFX/USDC collateral.
2. **Keeper Detection**: Decentralized keeper nodes detect the emitted `OrderCreated` event.
3. **Execution**: Keepers validate off-chain state and execute the order via `executeOrder`, injecting the latest Pyth oracle blob.
4. **Settlement**: `TradingCore` verifies the oracle blob, updates the position token, and realizes exposure against `VaultCore`.

### Oracle Integration
By utilizing **Pyth Network's pull-based logic**, Realyx eliminates continuous on-chain gas costs. Prices are updated deterministically only at the exact block they are required for execution or liquidation.

---

## 🔒 Security Posture

- **Circuit Breakers**: `OracleAggregator` halts market execution automatically if oracle freshness or confidence intervals deteriorate.
- **Insurance Fund Provisioning**: A mandatory slice of Vault TVL explicitly siloed to cover bad debt during flash crashes.
- **Guardian Quorum**: Protocol parameters are strictly governed by a multi-signature logic layer.
