# Realyx API Reference

Backend API and optional realtime channel for the Realyx frontend.

## Base URLs

| Environment | REST Base URL | Realtime |
|---|---|---|
| Local | `http://localhost:3001/api` | `ws://localhost:3002` when `ENABLE_WS=true` |
| Serverless (single project) | `/api` | No native backend websocket (use polling) |

## REST Endpoints

Both the legacy (`/api/...`) and versioned (`/api/v1/...`) prefixes are served and route to the same handlers unless noted.

| Method | Path | Description |
|---|---|---|
| GET | `/markets` | Market list with on-chain/indexed metrics |
| GET | `/markets/price-history/:marketId?days=7` | Historical market prices |
| GET | `/user/:address/positions` | Open positions for wallet |
| GET | `/user/:address/trades?limit=20` | Trade history for wallet |
| GET | `/stats` | Protocol summary metrics: TVL, 24h Volume, Open Interest, Active Traders, Liquidations |
| GET | `/stats/history` | Daily aggregated metrics: Volume, Trades, Fees |
| GET | `/vault/yield` | LP real-yield breakdown — APR by source (borrow/trading fees, funding, liquidations) + 30d APR history, normalized to live TVL |
| GET | `/status` | Public transparency feed — overall + per-component health (oracle, RPC, indexer, vault), uptime, vault solvency ratio, insurance-fund size |
| GET | `/leaderboard?limit=10&timeframe=all` | Global trader rankings by Realized PnL and Volume |
| GET | `/insurance/claims?limit=20` | History of covered bad debt claims from the insurance tranche |
| GET | `/referrals/stats?address=0x...` | On-chain referral stats (code, referees, totalEarned, pendingClaim) |
| GET | `/pyth-refresh` | Refresh cached Pyth prices (optionally gated by `CRON_SECRET`) |
| GET | `/sync` | Manual index sync trigger (optionally protected by `CRON_SECRET`) |

### Copy-trading (social) — `/api/v1/social`

| Method | Path | Description |
|---|---|---|
| GET | `/social/top-traders` | Registered lead traders ranked by ROI |
| GET | `/social/trader/:address` | Lead-trader profile + open positions |
| GET | `/social/copier/:address/following` | Lead traders a copier follows |
| GET | `/social/copier/:address/pnl` | Aggregated copied PnL per lead trader |
| POST | `/social/refresh` | Refresh the copy engine's lead-trader cache |

> Copy-trading endpoints return `501` (or an empty set) on deployments where the copy-trading schema is not provisioned.

### Authenticated / internal

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/key` | EIP-712 signature | Issue an opaque API key (tiered) for a wallet |
| GET | `/api/v1/auth/verify` | `x-api-key` header | Verify an API key and return its tier/owner |
| POST | `/api/v1/keeper/failure` | `Authorization: Bearer KEEPER_WEBHOOK_SECRET` | Keeper-bot failure webhook (broadcast to user WS) |
| GET | `/api/v1/keeper/failures/:traderAddress` | — | Historical keeper failures for a user |
| GET | `/api/debug` | `DEBUG_SECRET` in prod | Indexer/DB diagnostics (404 in prod when no secret) |

Health endpoints are outside `/api`:
- `GET /health`
- `GET /health/detailed`

Prometheus metrics are served on a separate internal port: `GET :METRICS_PORT/metrics` (default `9090`).

## Response Envelope

Successful and error responses follow:

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": "message" }
```

## WebSocket (Optional)

When backend WS is enabled (`ENABLE_WS=true` and non-serverless runtime), clients can subscribe to channels:

```json
{ "type": "subscribe", "channels": ["prices", "stats"] }
```

Typical message types:
- `price_update`
- `stats_update`
- `funding_update`

In serverless mode, keep `VITE_WS_URL` empty and rely on polling endpoints (frontend already supports this mode).
