# Realyx — Subgraph

Subgraph for indexing **TradingCore**, **VaultCore**, **OracleAggregator**, **PositionToken**, and **DividendManager** events.

## Contract analysis

See [../docs/CONTRACT_ANALYSIS.md](../docs/CONTRACT_ANALYSIS.md) for full contract structure and event map.

## Setup

## Setup

```bash
cd subgraph
npm install
```

## Config

- **Network**: Conflux eSpace Testnet (default). Addresses in `subgraph.yaml` match `deployment/confluxTestnet.json`.
- For other networks: update `subgraph.yaml` data source `source.address` and `network`, and run `graph codegen`.

## Mapping Refactor

The mappings have been refactored to use **standard generated entity classes** (e.g., `Position`, `Market`, `User`) instead of manual `Entity` operations. This aligns with Graph development best practices and provides full type safety during development.

## Build

```bash
npm run codegen   # Regenerate from schema + ABIs (overwrites generated/)
npm run build
```

## Deploy

### Self-hosted (Conflux eSpace e.g. Local Development)

1. **Start the Graph Node stack** (Postgres, IPFS, Graph Node):
   ```bash
   # From the project root
   docker-compose -f docker-compose.graph.yml up -d
   ```

2. **Create the subgraph** on the local node:
   ```bash
   # From the subgraph directory
   npm run create:local
   ```

3. **Deploy to the local node**:
   ```bash
   npm run deploy:local
   ```

The local indexing status can be monitored at `http://localhost:8000/subgraphs/name/realyx/1.0.0/graphql`.

> [!TIP]
> **Using Local Subgraph with Backend**:
> To point your backend to the local Graph Node instead of Studio, update `SUBGRAPH_URL` in `backend/.env`:
> - If running backend **locally**: `http://localhost:8000/subgraphs/name/realyx/1.0.0/graphql`
> - If running backend **in Docker**: `http://graph-node:8000/subgraphs/name/realyx/1.0.0/graphql`

### Graph Studio (Hosted Service)

1. Create a subgraph at [Subgraph Studio](https://thegraph.com/studio/) and copy your **deploy key**.
2. Provide the key:
   - **Saved auth (local)**:
     ```bash
     npm run auth:studio -- <your_deploy_key_here>
     npm run deploy:studio
     ```
3. When prompted, enter a **version label** (e.g. `0.0.1`).

## Schema summary

| Entity | Description |
|--------|-------------|
| Protocol | Singleton protocol stats (positions, trades, volume, fees, liquidations, TVL) |
| Market | Per-market config and funding (address = market key) |
| User | Trader/LP (by address); positions, trades, deposits, withdrawals |
| Position | Open/closed/liquidated position (positionId) |
| Trade | Open/close/liquidate event |
| Order | Limit/market order lifecycle |
| FundingSnapshot | Per-market funding rate history |
| PriceSnapshot | Oracle price updates |
| BreakerEvent | Circuit breaker triggered/reset |
| VaultDeposit | LP deposit/withdraw |
| WithdrawalRequest | Queued/processed withdrawal |
| InsuranceStake | Insurance stake/unstake |
| BadDebtClaim | Claim submitted/covered |
| DividendDistribution | Dividend per marketId |
| PositionTokenEvent | Mint/burn of position NFT |

## Queries (examples)

```graphql
{
  positions(where: { state: "OPEN" }, first: 10) {
    id
    positionId
    trader { id }
    market { id marketAddress }
    size
    entryPrice
    leverage
    state
  }
  trades(first: 20, orderBy: timestamp, orderDirection: desc) {
    id
    type
    position { positionId }
    trader { id }
    market { id }
    size
    price
    realizedPnl
    timestamp
  }
  protocol(id: "1") {
    totalPositionsOpened
    totalTrades
    totalVolumeUsd
    totalFeesUsd
    totalLiquidations
    tvl
  }
}
```
