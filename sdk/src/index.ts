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
export { OrderBuilder } from "./orders";
export type { RealyxConfig, SubaccountConfig, OrderParams, Market, Position } from "./types";