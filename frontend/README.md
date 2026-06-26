# Realyx Frontend

React + Vite client for markets, trading, portfolio, vault, insurance, leaderboard, copy trading, trader profiles, referrals, analytics, and a public status page. Ships as an installable PWA with off-app alerts.

## Setup

From the **project root**:
```bash
npm install
npm install --workspace frontend
cp frontend/.env.example frontend/.env
```

Or from the **frontend directory**:
```bash
npm install
cp .env.example .env
```

## Run

```bash
npm run dev
```

Default local URL: `http://localhost:5173`.

## Build

```bash
npm run build
npm run preview
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001/api` | Backend API base URL |
| `VITE_WS_URL` | empty | Optional websocket URL; leave empty for polling mode |
| `VITE_CHAIN_ID` | `71` | Conflux eSpace testnet |
| `VITE_RPC_URL` | `https://evmtestnet.confluxrpc.com` | Primary RPC |
| `VITE_CONFLUX_TESTNET_RPC_URL` | `https://evmtestnet.confluxrpc.com` | Explicit testnet RPC |
| `VITE_APP_URL` | - | Optional app metadata URL for wallet integration |
| `VITE_WALLET_CONNECT_PROJECT_ID` | required | WalletConnect project id |
| `VITE_TRADING_CORE_ADDRESS` | required | TradingCore contract |
| `VITE_VAULT_CORE_ADDRESS` | required | VaultCore contract |
| `VITE_ORACLE_AGGREGATOR_ADDRESS` | required | OracleAggregator contract |
| `VITE_POSITION_TOKEN_ADDRESS` | `0xF520CC4B305553A9b6D391571c303E45AacC178c` (testnet; sync with repo `deployment/confluxTestnet.json`) | PositionToken (ERC721); required for position NFT transfer UI |
| `VITE_MOCK_USDT0_ADDRESS` | required (testnet) | Mock USDT0 address |
| `VITE_COLLATERAL_REGISTRY_ADDRESS` | optional | CollateralRegistry (multi-collateral); set after deploy |
| `VITE_COPY_REGISTRY_ADDRESS` | optional | CopyRegistry for copy trading; set after deploy |
| `VITE_REFERRAL_REGISTRY_ADDRESS` | optional | ReferralRegistry for referral rebates; set after deploy |
| `VITE_COPY_BOT_ADDRESS` | optional | CopyBot EOA that mirrors lead-trader orders (CopyModal) |
| `VITE_USDT0_ADDRESS` | optional | USDT0 used for copy-trading allocations (defaults to mock USDT0 on testnet) |
| `VITE_MOCK_MODE` | `false` | UI/testing toggle |

## ☁️ Serverless / Polling Mode

Realyx is fully optimized for serverless environments where persistent WebSockets are naturally restricted.

- **Automatic Polling Fallback**: When `VITE_WS_URL` is detected as empty or unreachable, the frontend automatically activates a high-performance REST polling mechanism.
- **Cache Synchronization**: Leveraging **Tanstack Query**, the application ensures that data from polling is intelligently merged and cached, providing a smooth user experience that mirrors the responsiveness of WebSocket updates.
- **Config for serverless**:
    - Set `VITE_API_URL=/api`
    - Keep `VITE_WS_URL` blank.
    - Set `VITE_CHAIN_ID=71` (Testnet).

---
