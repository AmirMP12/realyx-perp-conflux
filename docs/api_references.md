# API References

The Realyx Backend provides a robust REST API and WebSocket interface for developers.

### Base URLs
- **REST**: `http://localhost:3001/api` (Development)
- **WebSocket**: `ws://localhost:3002`

---

## REST API Endpoints

### 1. Markets
`GET /markets`
- **Description**: Returns all active and listed trading pairs.
- **Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "BTC/USD",
      "address": "0x...",
      "maxLeverage": 10,
      "isActive": true
    }
  ]
}
```

### 2. User Positions
`GET /user/:address/positions`
- **Description**: Returns all currently open positions for a specific wallet.
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
      "pnl": 45.2
    }
  ]
}
```

### 3. Protocol Stats
`GET /stats`
- **Description**: High-level protocol metrics including volume and TVL.
- **Response**:
```json
{
  "success": true,
  "data": {
    "totalVolumeUSD": 12500000,
    "totalFeesUSD": 6250,
    "tvl": 500000
  }
}
```

---

## WebSocket Stream

Connect to `ws://localhost:3002` to receive real-time updates.

### Subscription Message
```json
{
  "type": "subscribe",
  "channels": ["prices", "stats"]
}
```

### Price Update Event
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

## Error Handling
All API responses that are not successful will return a `4xx` or `5xx` status code with the following body:
```json
{
  "success": false,
  "error": "Error message description"
}
```
