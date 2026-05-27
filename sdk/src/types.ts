/**
 * SDK Type Definitions
 */

import { ethers } from "ethers";

/** Configuration for the RealyxClient */
export interface RealyxConfig {
  /** REST API base URL, e.g. https://api.realyx.xyz */
  apiBaseUrl: string;
  /** WebSocket URL, e.g. wss://ws.realyx.xyz */
  wsUrl?: string;
  /** API key obtained from /api/v1/auth/key */
  apiKey?: string;
  /** Subaccount / delegated trading configuration */
  subaccount?: SubaccountConfig;
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
  /** Optional: ethers provider or RPC URL for the bot wallet */
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

/** Market info returned from API */
export interface Market {
  address: string;
  symbol: string;
  name: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  maxLeverage: number;
  maxPositionSize: string;
  isActive: boolean;
  longOpenInterest: string;
  shortOpenInterest: string;
}

/** Position info returned from API */
export interface Position {
  id: number;
  owner: string;
  market: string;
  size: string;
  entryPrice: string;
  liquidationPrice: string;
  leverage: number;
  isLong: boolean;
  collateral: string;
  unrealizedPnl: string;
  status: string;
}

/** WebSocket message types */
export type WsMessage =
  | { type: "price"; data: { symbol: string; price: string; timestamp: number } }
  | { type: "trade"; data: { symbol: string; price: string; size: string; side: "buy" | "sell"; timestamp: number } }
  | { type: "orderbook"; data: { symbol: string; bids: [string, string][]; asks: [string, string][] } }
  | { type: "position"; data: Position }
  | { type: "error"; data: { message: string } }
  | { type: "subscribed" | "unsubscribed"; data: { channel: string } };