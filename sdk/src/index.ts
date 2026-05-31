/**
 * @realyx/sdk — Strategy SDK for RealYX Perpetual Futures
 *
 * Features:
 * - WebSocket wrapper with auto-reconnect for real-time price & market updates
 * - Helper methods to construct, sign, and broadcast orders using ethers.js v6
 * - Native subaccount (delegated trading) support
 */

export { RealyxClient } from "./client";
export { RealyxWs } from "./ws";
export type { RealyxWsOptions, WsState } from "./ws";
export { OrderBuilder } from "./orders";
export type { OrderBuilderConfig, CreateOrderTuple } from "./orders";
export { OrderTypeEnum, TimeInForceEnum } from "./types";
export type {
  RealyxConfig,
  SubaccountConfig,
  OrderParams,
  Market,
  Position,
  ProtocolStats,
  Trade,
  LeaderboardEntry,
  WsMessage,
} from "./types";
