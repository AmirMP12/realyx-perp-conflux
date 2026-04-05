# Known Issues & Limitations

This document tracks known technical limitations and planned improvements for the Realyx protocol on Conflux eSpace.

## 1. Liquidity & Execution

### Liquidation Race Conditions
In highly volatile markets, multiple liquidators may attempt to liquidate the same position simultaneously. While the protocol handles initial execution correctly, subsequent transactions will revert with an "Already Liquidated" error, wasting gas for liquidators.
- **Workaround**: Keepers should use high-performance RPCs to minimize latency.
- **Planned Fix**: Implement a pre-settlement queue for liquidations.

### Pull Oracle Latency
Using the Pyth pull-model requires an on-chain transaction to update the price before execution. This can lead to a slight delay (1-2 seconds) between order submission and execution.
- **Status**: Native to pull-oracles. Optimized via high-frequency keeper bots.

## 2. Infrastructure

### Subgraph Sync Delay
The Graph indexing can sometimes lag behind the blockchain state by a few blocks. This may cause the UI to briefly show outdated data (e.g., a recently closed position still appearing as open).
- **Status**: Actively monitoring Graph Node performance. Use WebSocket stream for real-time frontend updates.

## 3. Protocol Design

### USDC Decimals (6)
Many older DEXs assume 18 decimals for all tokens. Realyx uses 6 decimals for USDC to align with native stablecoins on Conflux eSpace.
- **Caution**: Integrating third-party tools should account for this non-standard decimal scaling.

### Insurance Fund Capacity
On Testnet, the Insurance Fund is bootstrapped with a fixed amount. Extreme volatility could technically deplete it if not properly managed.
- **Risk Mitigation**: Dynamic cap on open interest based on vault utilization.

---
*To report a bug, please open an issue in the GitHub repository or contact the core team via Discord.*
