# ⚠️ Known Issues & Technical Limitations

Transparency is a core tenet of the Realyx protocol. This document outlines active technical limitations, known edge cases, and our internal roadmap for remediation on **Conflux eSpace**.

---

## 1. Liquidity & Execution Constraints

### 🏎️ Liquidation Race Conditions
**Description:** Extreme market volatility naturally incentivizes multiple decentralized liquidators to target the same underwater position. While the protocol flawlessly validates the first execution, subsequent keeper transactions will revert (e.g., `Already Liquidated`), burning gas for slower keepers.
- **Current Workaround:** Keeper developers are advised to utilize private, low-latency RPC endpoints and incorporate rapid mempool checks.
- **Planned Resolution:** Re-architecting the settlement layer into a batched queue system to eliminate zero-sum gas wars.

### ⏱️ Pull Oracle Latency
**Description:** The Pyth pull-model inherently requires a user or keeper to attach a price-update payload to execute a trade. This creates a fractional delay (typically ~1-2 seconds) between UI click and chain confirmation.
- **Current Status:** Expected behavior native to on-demand oracles. We are actively optimizing our proprietary high-frequency keeper bots to subsidize and accelerate this workflow.

---

## 2. Infrastructure & Indexing

### 📉 database indexer Sync Variance
**Description:** Native PostgreSQL Indexer can occasionally trail behind the tip of the Conflux eSpace blockchain by a few blocks during high network congestion.
- **Impact:** The UI may momentarily display stale portfolio balances or positions that were recently liquidated.
- **Planned Resolution:** Extensive load-balancing across local graph nodes and migrating real-time data dependency toward our proprietary WebSocket layer for instant UI rendering.

---

## 3. Protocol Architecture Specifics

### 🪙 Token Decimals (6 vs 18)
**Description:** Realyx anchors to a **6-decimal** standard for stablecoins (mirroring USDC natively). Certain legacy DeFi analytics or integrators blindly assume EVM tokens use 18 decimals.
- **Caution:** Developers integrating Realyx contracts or reading Vault balances must normalize outputs by `10^6` rather than `10^18`.

### 🏦 Insurance Fund Scalability (Testnet)
**Description:** On the Testnet instance, the Insurance Fund holds a static bootstrap value. A synchronized flash crash could hypothetically deplete this test fund if simulated open interest is uncapped.
- **Planned Resolution:** Mainnet deployment introduces dynamic, algorithmically enforced Open Interest (OI) ceilings strictly correlated to vault utilization metrics.

---
*Encountered a bug not listed here? Please submit an issue via our [GitHub Repository](https://github.com/AmirMP12/realyx-perp-dex) or alert the core team on Discord.*
