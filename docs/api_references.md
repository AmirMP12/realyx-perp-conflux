# 📡 Realyx API Reference

Welcome to the **Realyx API Setup**. The Realyx backend provides a robust REST API and a low-latency WebSocket interface. These endpoints abstract away complex database indexer interactions and off-chain routing, providing seamless access to perpetual futures data on **Conflux eSpace**.

---

## 🔗 Base URLs

| Environment | Protocol | URL | Description |
|---|---|---|---|
| **Local (REST)** | HTTP | `http://localhost:3001/api` | Base URL for all REST API endpoints. |
| **Local (WebSocket)** | WS | `ws://localhost:3002` | Real-time event streaming and price feeds. |

*Note: For production, replace `localhost` with your actual deployment domain.*

---

## 🛠️ REST API Endpoints

### 1. Markets
Retrieve all active and listed trading pairs, including collateral requirements and leverage limits.

- **Endpoint**: `GET /markets`
- **Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "BTC/USD",
      "address": "0x...",
      "maxLeverage": 10,
      "isActive": true,
      "assetClass": "crypto"
    }
  ]
}
```

### 2. User Positions
Fetch all currently open positions for a specific wallet address, including unrealized PnL.

- **Endpoint**: `GET /user/:address/positions`
- **Parameters**: 
  - `address` (path): The EVM address of the user.
- **Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "market": "BTC/USD",
      "size": 1500,
      "leverage": 5,
      "pnl": 45.2,
      "entryPrice": 62000.00
    }
  ]
}
```

### 3. Protocol Statistics
Retrieve high-level protocol metrics, useful for dashboards and leaderboards.

- **Endpoint**: `GET /stats`
- **Response**:
```json
{
  "success": true,
  "data": {
    "totalVolumeUSD": 12500000,
    "totalFeesUSD": 6250,
    "tvl": 500000,
    "openInterestUSD": 250000
  }
}
```

---

## ⚡ WebSocket Stream

Connect to `ws://localhost:3002` to receive real-time updates without polling the REST API.

### Subscription Message
Send a JSON payload to subscribe to specific telemetry channels:
```json
{
  "type": "subscribe",
  "channels": ["prices", "stats", "liquidations"]
}
```

### Price Update Event
Once subscribed, your client will receive asynchronous events:
```json
{
  "channel": "prices",
  "data": {
    "market": "BTC/USD",
    "price": 64500.50,
    "timestamp": 1711234567
  }
}
```

---

## 🛡️ Error Handling

All failed API responses return standard HTTP status codes (`4xx` or `5xx`) along with a consistent JSON body outlining the failure:

```json
{
  "success": false,
  "error": "Detailed error message describing the failure."
}
```
