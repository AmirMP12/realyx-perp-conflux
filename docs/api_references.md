# Realyx API Reference

Backend API and optional realtime channel for the Realyx frontend.

## Base URLs

| Environment | REST Base URL | Realtime |
|---|---|---|
| Local | `http://localhost:3001/api` | `ws://localhost:3002` when `ENABLE_WS=true` |
| Vercel (single project) | `/api` | No native backend websocket (use polling) |

## REST Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/markets` | Market list with on-chain/indexed metrics |
| GET | `/markets/price-history/:marketId?days=7` | Historical market prices |
| GET | `/user/:address/positions` | Open positions for wallet |
| GET | `/user/:address/trades?limit=20` | Trade history for wallet |
| GET | `/stats` | Protocol summary metrics: TVL, 24h Volume, Open Interest, Active Traders, Liquidations |
| GET | `/stats/history` | Daily aggregated metrics (90 days): Volume, Trades, Fees |
| GET | `/leaderboard?limit=10&timeframe=all` | Global trader rankings by Realized PnL and Volume |
| GET | `/insurance/claims?limit=20` | History of covered bad debt claims from the Insurance Fund |
| GET | `/sync` | Manual index sync trigger (optionally protected by `CRON_SECRET`) |

Health endpoints are outside `/api`:
- `GET /health`
- `GET /health/detailed`

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

On Vercel, keep `VITE_WS_URL` empty and rely on polling endpoints (frontend already supports this mode).
