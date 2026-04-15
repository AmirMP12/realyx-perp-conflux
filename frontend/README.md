# Realyx Frontend

React + Vite client for trading, portfolio, vault, insurance, and analytics.

## Setup

```bash
cd frontend
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
| `VITE_WS_URL` | empty | Optional websocket URL; leave empty on Vercel |
| `VITE_CHAIN_ID` | `71` | Conflux eSpace testnet |
| `VITE_RPC_URL` | `https://evmtestnet.confluxrpc.com` | Primary RPC |
| `VITE_CONFLUX_TESTNET_RPC_URL` | `https://evmtestnet.confluxrpc.com` | Explicit testnet RPC |
| `VITE_APP_URL` | - | Optional app metadata URL for wallet integration |
| `VITE_WALLET_CONNECT_PROJECT_ID` | required | WalletConnect project id |
| `VITE_TRADING_CORE_ADDRESS` | required | TradingCore contract |
| `VITE_VAULT_CORE_ADDRESS` | required | VaultCore contract |
| `VITE_ORACLE_AGGREGATOR_ADDRESS` | required | OracleAggregator contract |
| `VITE_POSITION_TOKEN_ADDRESS` | `0x4368b5741A105c1ACE50ad98581fDa050685fa8B` (testnet; sync with repo `deployment/confluxTestnet.json`) | PositionToken (ERC721); required for position NFT transfer UI |
| `VITE_MOCK_USDC_ADDRESS` | required (testnet) | Mock USDC address |
| `VITE_MOCK_MODE` | `false` | UI/testing toggle |

## Vercel Mode

For single-project Vercel deploy:
- Set `VITE_API_URL=/api`
- Keep `VITE_WS_URL` empty (frontend will rely on polling)
