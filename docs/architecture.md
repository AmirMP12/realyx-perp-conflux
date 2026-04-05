# Architecture Overview

Realyx is a decentralized Perpetual DEX on **Conflux eSpace**, optimized for Real-World Asset (RWA) futures with high leverage and low latency.

## Core Components

### 1. Smart Contracts (Solidity)
The protocol uses a modular design to ensure scalability and maintainability:

- **`TradingCore`**: The main entry point for all user interactions. It handles order creation, execution (via keepers), and position management.
- **`VaultCore`**: Manages the protocol's liquidity. It serves as the counterparty to all trades, handles LP deposits/withdrawals, and maintains the Insurance Fund.
- **`OracleAggregator`**: Centralized price routing. Integrates with **Pyth Network** to provide low-latency, confidence-weighted price feeds.
- **`PositionToken` (ERC722)**: A soul-bound NFT representation of each open position, enabling future composability and secondary market features.

### 2. Backend Services (Node.js/Express)
The backend provides a high-performance REST and WebSocket API for the frontend. It abstracts the complexity of the Subgraph and facilitates real-time data streaming.

### 3. Indexing Layer (The Graph)
A specialized subgraph indexes all protocol events from Conflux eSpace. This allows for complex historical queries, trade history, and leaderboard calculations that are not possible directly via RPC.

## System Flow

### Trade Execution Lifecycle
1. **Order Creation**: User submits `createOrder` to `TradingCore` with CFX collateral.
2. **Keeper Detection**: Off-chain keepers monitor `OrderCreated` events.
3. **Execution**: Keepers call `executeOrder` with valid Pyth price updates and signatures.
4. **Settlement**: `TradingCore` updates position state and adjusts `VaultCore` exposure.

### Oracle Integration
Realyx leverages **Pyth Network's pull-based oracle model**. Prices are only updated on-chain when needed for trade execution or liquidations, significantly reducing gas costs on Conflux eSpace.

## Security Features
- **Circuit Breaker**: `OracleAggregator` can pause markets if Pyth prices become stale or confidence intervals widen too far.
- **Insurance Fund**: A dedicated buffer within `VaultCore` to cover protocol insolvency during extreme volatility.
- **Guardian Quorum**: Critical system parameters require a multi-signature quorum for updates.

---
*For more details, see [../README.md](../README.md).*
