# Deploying Realyx on Railway

Railway runs long-lived processes, so you get the real WebSocket server, a
continuously-running indexer worker, and the keeper/liquidation bots — none of
which fit a serverless model.

This file is the quick service/env reference.

The smart contracts are **not** hosted here. They live on Conflux eSpace and are
deployed once with the `scripts/deploy-*.ts` hardhat scripts. Railway only runs
the off-chain services that index and drive those contracts.

## Services

| Railway service | Root dir   | Config file (Config-as-code path) | Purpose                                   |
| --------------- | ---------- | --------------------------------- | ----------------------------------------- |
| `postgres`      | —          | Railway Postgres plugin           | Primary datastore (the only hard dep)     |
| `api`           | `backend`  | `railway.json`                    | REST API + WebSocket (`node dist/index.js`) |
| `indexer`       | `backend`  | `railway.indexer.json`            | Chain indexer / writer (`node dist/worker.js`) |
| `keeper`        | `/` (root) | `railway.keeper.json`             | Order-execution keeper bot                |
| `liquidation`   | `/` (root) | `railway.liquidation.json`        | Liquidation bot (optional)                |
| `frontend`      | `frontend` | `railway.json`                    | Static SPA served by nginx                |
| `landing`       | `landing`  | `railway.json`                    | Static marketing site served by nginx     |
| `docs`          | `docs-site`| `railway.json`                    | Static docs site served by nginx          |

Minimum viable deployment is **postgres + api + indexer + keeper**. Add the
liquidation bot and frontend as needed. Redis is optional (the API falls back to
an in-memory cache when `REDIS_URL` is unset).

## One-time setup per service

For each non-plugin service in the Railway dashboard:

1. **New Service → Deploy from Repo**, pick this repo.
2. **Settings → Source → Root Directory**: set per the table above.
3. **Settings → Build → Config-as-code path**: set per the table above. Two
   services (`api`, `indexer`) share the `backend` root but point at different
   config files, which is how they get different start commands from one image.
4. Add the environment variables below.

## Postgres

Add the **Railway Postgres** plugin. It exposes `DATABASE_URL`. This codebase
reads `POSTGRES_URL`, so on the `api` and `indexer` services add a reference
variable:

```
POSTGRES_URL = ${{Postgres.DATABASE_URL}}
```

The `indexer` is the only writer. The `api` runs read-only (`DISABLE_INBAND_SYNC=true`).
If you later add a read replica, point the API at it with `POSTGRES_READ_URL`.

## Environment variables

### api + indexer (shared chain config)

```
CHAIN_ID=71
RPC_URL=https://evmtestnet.confluxrpc.com
RPC_FALLBACK_URL=https://evmtestnet.confluxrpc.org
TRADING_CORE_ADDRESS=0xc8A6585dFBe2833ed093E557D36DC8Fe136a8c76
VAULT_CORE_ADDRESS=0x98E011A8782aF36C5Ad6051bC54B86a7c0705F67
ORACLE_AGGREGATOR_ADDRESS=0x9d027ab66F396176C188946cE49BA9061679e6a9
REFERRAL_REGISTRY_ADDRESS=0x5FbD3aBfBdB667e543B23B80f34Fa7167C1514a8
```

(For mainnet use `CHAIN_ID=1030`, `RPC_URL=https://evm.confluxrpc.com`, and the
mainnet contract addresses.)

### api (additional)

```
NODE_ENV=production
PORT=3001
POSTGRES_URL=${{Postgres.DATABASE_URL}}
DISABLE_INBAND_SYNC=true        # the indexer owns ingestion
ENABLE_WS=false                 # see "WebSockets" below; default to polling
CORS_ORIGINS=https://<your-frontend-domain>
# REDIS_URL=${{Redis.REDIS_URL}}        # optional
# KEEPER_WEBHOOK_SECRET=<shared bearer secret with the keeper bot>  # enables failure notifications
```

### indexer (additional)

```
NODE_ENV=production
POSTGRES_URL=${{Postgres.DATABASE_URL}}
INDEXER_INTERVAL_MS=5000
```

### keeper

The keeper uses its **own** `KEEPER_*` variables (it does not read the shared
`RPC_URL`). It loads contract addresses from `deployment/<KEEPER_NETWORK>.json`
(baked into the image), or from the override env vars below.

```
NODE_ENV=production
KEEPER_NETWORK=confluxTestnet                     # "conflux" for mainnet
KEEPER_RPC_URL=https://evmtestnet.confluxrpc.com  # required
KEEPER_PRIVATE_KEY=<funded signer private key>    # SECRET — set only in Railway
# Optional overrides / tuning:
# KEEPER_RPC_URLS=https://evmtestnet.confluxrpc.com,https://evmtestnet.confluxrpc.org  # CSV failover pool
# KEEPER_TRADING_CORE_ADDRESS=0x...               # else taken from deployment file
# KEEPER_API_BASE_URL=https://<your-api-domain>   # for failure webhooks
# KEEPER_WEBHOOK_SECRET=<same value as the api service>  # enables failure notifications
# KEEPER_HERMES_URL=https://hermes.pyth.network
# KEEPER_POLL_INTERVAL_SECONDS=3
# KEEPER_MAX_CONCURRENCY=4
```

### liquidation (optional)

Falls back to the `KEEPER_*` equivalents when the `LIQ_*` var is unset.

```
NODE_ENV=production
LIQ_NETWORK=confluxTestnet                         # or inherits KEEPER_NETWORK
LIQ_RPC_URL=https://evmtestnet.confluxrpc.com      # or inherits KEEPER_RPC_URL
LIQ_PRIVATE_KEY=<funded liquidator key>            # or inherits KEEPER_PRIVATE_KEY
# LIQ_TRADING_CORE_ADDRESS=0x...                    # else from deployment file
# LIQ_POLL_INTERVAL_SECONDS=5
```

> **Security:** the keeper/liquidation signer sends real transactions and must
> hold native CFX for gas plus `KEEPER_ROLE` / `LIQUIDATOR_ROLE` on TradingCore
> (grant with `scripts/grant-keeper-role.ts` / `scripts/setup-keeper-network.ts`).
> Treat the private key as a production secret: set it only in Railway's service
> variables, never commit it. Use a dedicated hot wallet, not an admin key.

### frontend (build args — Vite bakes these at build time)

The frontend is static, so the backend URLs are compiled in. Set these as
service variables; the Dockerfile forwards them as build args.

```
PORT=8080                       # nginx listens on 8080; Railway routes to this
VITE_API_URL=https://<your-api-domain>/api
VITE_WS_URL=                    # empty = polling mode (recommended on Railway)
VITE_RPC_URL=https://evmtestnet.confluxrpc.com
VITE_WALLET_CONNECT_PROJECT_ID=<your id>
VITE_TRADING_CORE_ADDRESS=0xc8A6585dFBe2833ed093E557D36DC8Fe136a8c76
VITE_VAULT_CORE_ADDRESS=0x98E011A8782aF36C5Ad6051bC54B86a7c0705F67
VITE_ORACLE_AGGREGATOR_ADDRESS=0x9d027ab66F396176C188946cE49BA9061679e6a9
VITE_POSITION_TOKEN_ADDRESS=0xF520CC4B305553A9b6D391571c303E45AacC178c
VITE_COLLATERAL_REGISTRY_ADDRESS=0x0f5cAC8a3BC4E61ABA1d547D9A2C1DFA5A087054
VITE_COPY_REGISTRY_ADDRESS=0xf09b2fa210Fe2dbE17287B331E7A93c58Bb5A001
VITE_REFERRAL_REGISTRY_ADDRESS=0x5FbD3aBfBdB667e543B23B80f34Fa7167C1514a8
VITE_MOCK_USDT0_ADDRESS=0x85B9BA60D6Aef728c0Ea9C9f6709D31707dfC73A
```

The frontend calls the API at the absolute `VITE_API_URL`, so nginx's built-in
`/api` and `/ws` proxy blocks (which target the docker-compose `backend` host)
are simply unused on Railway. Make sure the API's `CORS_ORIGINS` includes the
frontend's public domain.

### landing + docs (static sites)

Both are dependency-free static sites (HTML/CSS/JS) served by the same
`nginx-unprivileged` image as the frontend, listening on **8080**. They have no
build args and no required env vars — just point each service at its root dir
and config file:

| Service   | Root Directory | Config-as-code path |
| --------- | -------------- | ------------------- |
| `landing` | `landing`      | `railway.json`      |
| `docs`    | `docs-site`    | `railway.json`      |

The healthcheck hits `/health` (returns `ok`). Add a custom domain in
Railway → Settings → Networking if you want `realyx.xyz` / `docs.realyx.xyz`.

## WebSockets

`startWsServer()` binds its own port (`WS_PORT`, default 3002), separate from the
API's HTTP port. A Railway service only exposes one public port, so the WS port
isn't reachable on the API's domain. Two options:

- **Polling (recommended, default):** leave `VITE_WS_URL` empty and set
  `ENABLE_WS=false` on the API. The SPA polls REST every few seconds.
- **Real WebSockets:** add a second backend service ("ws") from the same
  `backend` root and image, set its service variable `PORT=3002` so Railway
  routes the public domain to the WS listener, then point the frontend at it
  with `VITE_WS_URL=wss://<ws-domain>/`.

## Crons

There are no external cron jobs to configure. The always-on `indexer` worker
drives sync on its own loop (`INDEXER_INTERVAL_MS`). There's nothing else to
schedule.

## Notes

- **Keeper failure notifications:** the keeper sends
  `Authorization: Bearer <KEEPER_WEBHOOK_SECRET>` to `/api/v1/keeper/failure`
  when `KEEPER_WEBHOOK_SECRET` is set. Set the same value on both the `api` and
  `keeper` services (plus `KEEPER_API_BASE_URL` on the keeper) to enable
  trader-facing failure pushes. Leave it unset to disable that endpoint in
  production; order execution is unaffected either way.
