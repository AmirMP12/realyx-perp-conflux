/**
 * SDK Type Definitions
 *
 * The REST shapes below mirror the backend's response payloads exactly
 * (see backend/src/types/index.ts and the route handlers). Keeping these in
 * lockstep guarantees that fields the SDK exposes actually exist at runtime.
 */

import { ethers } from "ethers";

/** Configuration for the RealyxClient */
export interface RealyxConfig {
  /** REST API base URL, e.g. https://app.realyx.xyz/api */
  apiBaseUrl: string;
  /** WebSocket URL, e.g. wss://app.realyx.xyz/ws */
  wsUrl?: string;
  /** API key obtained from /api/v1/auth/key */
  apiKey?: string;
  /** Subaccount / delegated trading configuration */
  subaccount?: SubaccountConfig;
  /**
   * TradingCore contract address used by the OrderBuilder.
   * If omitted, falls back to `process.env.TRADING_CORE_ADDRESS`.
   */
  tradingCoreAddress?: string;
  /**
   * Explicit signer for direct (non-subaccount) trading. When provided, the
   * OrderBuilder will sign and broadcast with this wallet. Alternatively call
   * `client.orders.setSigner(signer)` after construction.
   */
  signer?: ethers.Signer;
  /** Request timeout for REST calls in ms (default 15_000). */
  requestTimeoutMs?: number;
  /** Number of retries for transient REST failures (default 2). */
  requestRetries?: number;
}

/**
 * Subaccount (delegated bot) configuration.
 * The bot wallet signs transactions and pays gas (native CFX).
 * The owner wallet is charged USDC collateral via TradingCore.transferFrom.
 */
export interface SubaccountConfig {
  /** Address of the primary account that owns positions and pays collateral */
  ownerAddress: string;
  /** Private key of the subaccount bot (must be approved via TradingCore.addSubaccount) */
  botPrivateKey: string;
  /** Optional: ethers provider for the bot wallet */
  provider?: ethers.Provider;
}

/**
 * Parameters for building a CreateOrder transaction.
 * Mirrors DataTypes.CreateOrderParams on-chain.
 */
export interface OrderParams {
  /** Market address (e.g. "0xAa...") */
  market: string;
  /** Size in USDC (6 decimals for USDC collateral, or 18 for protocol precision) */
  sizeDelta: string;
  /** Collateral amount in USDC (6 decimals) */
  collateralDelta: string;
  /** Direction */
  isLong: boolean;
  /** Order type */
  orderType: "MARKET_INCREASE" | "MARKET_DECREASE" | "LIMIT_INCREASE" | "LIMIT_DECREASE";
  /** Trigger price for limit orders (protocol precision, 1e18) */
  triggerPrice?: string;
  /** Max slippage in BPS (e.g. 50 = 0.5%) */
  maxSlippage?: number;
  /** Existing position ID to modify/close (0 for new position) */
  positionId?: number;
  /** Default GTC */
  tif?: "GTC" | "IOC" | "FOK" | "POST_ONLY";
  /** Bracket: stop-loss price */
  stopLossPrice?: string;
  /** Bracket: take-profit price */
  takeProfitPrice?: string;
  /** Iceberg visible size per slice */
  visibleSize?: string;
  /** TWAP interval in seconds */
  twapInterval?: number;
  /** Reduce-only flag */
  isReduceOnly?: boolean;
}

/** Enum mapping for on-chain OrderType */
export enum OrderTypeEnum {
  MARKET_INCREASE = 0,
  MARKET_DECREASE = 1,
  LIMIT_INCREASE = 2,
  LIMIT_DECREASE = 3,
}

/** Enum mapping for on-chain TimeInForce */
export enum TimeInForceEnum {
  GTC = 0,
  IOC = 1,
  FOK = 2,
  POST_ONLY = 3,
}

/** Asset category as returned by GET /api/v1/markets. */
export type MarketCategory = "CRYPTO" | "STOCK" | "COMMODITY" | "FOREX";

/**
 * Market info returned from GET /api/v1/markets.
 * Mirrors the backend `BackendMarket` shape.
 */
export interface Market {
  /** Lowercased market address (also the row id) */
  id: string;
  name: string;
  symbol: string;
  /** Logo/image URL (may be empty) */
  image: string;
  /** Market contract address */
  marketAddress: string;
  category?: MarketCategory;
  /** Oracle/index price (human units) */
  indexPrice: string;
  /** Last traded / mark price (human units) */
  lastPrice: string;
  /** 24h notional volume in USD */
  volume24h: string;
  /** Long open interest (18-decimal human string) */
  longOI: string;
  /** Short open interest (18-decimal human string) */
  shortOI: string;
  /** Funding rate (human units, 6dp) */
  fundingRate: string;
  maxLeverage: number;
  /** True when trading is paused (inverse of "active") */
  isPaused: boolean;
  /** 24h price change percentage (optional) */
  change24h?: number;
}

/**
 * Position info returned from GET /api/v1/user/:address/positions.
 * Mirrors the backend `BackendPosition` shape.
 */
export interface Position {
  id: number;
  /** Market is returned as a nested object, not a bare address. */
  market: {
    id: string;
    name: string;
    symbol: string;
    collectionName: string;
    collectionImage: string;
  };
  side: "LONG" | "SHORT";
  size: string;
  entryPrice: string;
  /** Collateral / margin backing the position (human units) */
  margin: string;
  leverage: number;
  unrealizedPnl: string;
  realizedPnl: string;
  liquidationPrice: string;
  breakEvenPrice: string;
  /** ISO-8601 open timestamp */
  openTs: string;
}

/**
 * Aggregate protocol stats returned from GET /api/v1/stats.
 * Mirrors the backend stats payload.
 */
export interface ProtocolStats {
  totalMarkets: number;
  volume24h: string;
  cumulativeVolumeUsd?: string;
  totalOpenInterest: string;
  /** Lifetime liquidation event count (not a wei amount) */
  totalLiquidations?: string;
  /** Distinct wallets active in the last 24h */
  activeTraders24h?: number;
  /** Server-side TVL from VaultCore.totalAssets() */
  tvl?: string;
}

/**
 * A single trade history record returned from
 * GET /api/v1/user/:address/trades. Mirrors the backend `TradeHistoryItem`.
 */
export interface Trade {
  id: number;
  /** Transaction hash of the trade */
  signature: string;
  /** Resolved market symbol (e.g. "BTC-USD") */
  market: string;
  side: "LONG" | "SHORT";
  size: string;
  price: string;
  leverage: number;
  fee: string;
  /** Realized PnL, or null for opens */
  pnl: string | null;
  type: "OPEN" | "CLOSE" | "LIQUIDATED";
  /** ISO-8601 timestamp */
  timestamp: string;
}

/**
 * A leaderboard entry returned from GET /api/v1/leaderboard.
 * Mirrors the backend `LeaderboardEntry` shape.
 */
export interface LeaderboardEntry {
  rank: number;
  /** Trader wallet address */
  wallet: string;
  /** Realized PnL (human units) */
  pnl: string;
  /** Cumulative volume in USD */
  volume: string;
  trades: number;
}

/**
 * Broadcast channels supported by the backend WebSocket server.
 * A connection receives only the channels present in its latest
 * `{ type: "subscribe", channels: [...] }` message.
 */
export type WsChannel = "prices" | "stats" | "funding";

/**
 * WebSocket message types emitted by the backend `wsServer`.
 *
 * The server tags every payload with a `type` and (for market-scoped events)
 * a top-level `marketAddress` mirrored inside `data`.
 */
export type WsMessage =
  | {
      type: "price_update";
      marketAddress?: string;
      data: { price: number; marketAddress: string; change24h?: number };
    }
  | {
      type: "funding_update";
      marketAddress?: string;
      data: { rate: number; marketAddress: string };
    }
  | {
      type: "stats_update";
      data: {
        volume24h: string;
        cumulativeVolumeUsd: string;
        totalOpenInterest: string;
        totalMarkets: number;
      };
    }
  | {
      // User-targeted notification (requires `subscribeUser(address)`).
      type: "KEEPER_FAILURE";
      traderAddress?: string;
      data: { orderId: string; failureReason: string; timestamp: number };
    }
  | { type: "pong"; ts: number }
  // Forward-compatible catch-all for any other user-scoped broadcast.
  | { type: string; data?: unknown; marketAddress?: string; traderAddress?: string };
