/**
 * RealyxClient — Main SDK entry point.
 * Provides REST helpers for markets, positions, trades, and a managed WebSocket.
 */

import { ethers } from "ethers";
import { RealyxWs } from "./ws";
import { OrderBuilder } from "./orders";
import type {
  RealyxConfig,
  SubaccountConfig,
  Market,
  Position,
  WsMessage,
  WsChannel,
  ProtocolStats,
  Trade,
  LeaderboardEntry,
} from "./types";

export class RealyxClient {
  public readonly config: RealyxConfig;
  public ws: RealyxWs;
  public readonly orders: OrderBuilder;

  private readonly apiBaseUrl: string;
  private readonly wsUrl: string;
  private readonly apiKey?: string;
  private readonly subaccount?: SubaccountConfig;
  private readonly requestTimeoutMs: number;
  private readonly requestRetries: number;

  constructor(config: RealyxConfig) {
    if (!config.apiBaseUrl) {
      throw new Error("RealyxConfig.apiBaseUrl is required");
    }
    this.config = config;
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, ""); // strip trailing slash
    this.wsUrl = config.wsUrl ?? this.apiBaseUrl.replace(/^http/, "ws") + "/ws";
    this.apiKey = config.apiKey;
    this.subaccount = config.subaccount;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15_000;
    this.requestRetries = config.requestRetries ?? 2;

    const tradingCoreAddress =
      config.tradingCoreAddress ?? process.env.TRADING_CORE_ADDRESS ?? ethers.ZeroAddress;

    this.orders = new OrderBuilder({
      tradingCoreAddress,
      subaccount: config.subaccount,
    });

    // Resolve a signer for the OrderBuilder. We do NOT silently create a random
    // throwaway wallet — that would let a caller think they can trade when they
    // cannot. Instead, a signer must come from a subaccount or be set explicitly.
    if (config.subaccount) {
      const provider = config.subaccount.provider;
      const signer = provider
        ? new ethers.Wallet(config.subaccount.botPrivateKey, provider)
        : new ethers.Wallet(config.subaccount.botPrivateKey);
      this.orders.setSigner(signer);
    } else if (config.signer) {
      this.orders.setSigner(config.signer);
    }
    // Otherwise: read-only client. Calling order methods throws a clear error
    // until `client.orders.setSigner(signer)` is called.

    this.ws = new RealyxWs({
      url: this.wsUrl,
      apiKey: config.apiKey,
    });
  }

  // ───── REST API Helpers ─────

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      h["x-api-key"] = this.apiKey;
    }
    return h;
  }

  private async get<T>(path: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.requestRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const res = await fetch(`${this.apiBaseUrl}${path}`, {
          headers: this.headers(),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text();
          // 4xx are not retried — they won't succeed on retry.
          if (res.status >= 400 && res.status < 500) {
            throw new Error(`GET ${path} failed (${res.status}): ${body}`);
          }
          lastErr = new Error(`GET ${path} failed (${res.status}): ${body}`);
        } else {
          return (await res.json()) as T;
        }
      } catch (err) {
        lastErr = err;
        // AbortError and 4xx (rethrown above) should bail; for 4xx we already threw.
        if (err instanceof Error && err.message.includes("failed (4")) {
          throw err;
        }
      } finally {
        clearTimeout(timer);
      }
      // Exponential backoff before the next attempt.
      if (attempt < this.requestRetries) {
        await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`GET ${path} failed`);
  }

  /**
   * Fetch all active markets.
   * GET /api/v1/markets → { success, data: Market[] }
   */
  async getMarkets(): Promise<Market[]> {
    const res = await this.get<{ success: boolean; data?: Market[] }>("/api/v1/markets");
    return res.data ?? [];
  }

  /**
   * Fetch positions for a user address.
   * GET /api/v1/user/:address/positions → { success, data: Position[] }
   */
  async getPositions(address: string): Promise<Position[]> {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
    const res = await this.get<{ success: boolean; data?: Position[] }>(
      `/api/v1/user/${address}/positions`
    );
    return res.data ?? [];
  }

  /**
   * Fetch trade history for a user address.
   * GET /api/v1/user/:address/trades → { success, data: Trade[] }
   */
  async getTrades(address: string): Promise<Trade[]> {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
    const res = await this.get<{ success: boolean; data?: Trade[] }>(
      `/api/v1/user/${address}/trades`
    );
    return res.data ?? [];
  }

  /**
   * Fetch stats (volume, open interest, etc.).
   * GET /api/v1/stats → { success, data: ProtocolStats }
   */
  async getStats(): Promise<ProtocolStats> {
    const res = await this.get<{ success: boolean; data?: ProtocolStats }>("/api/v1/stats");
    if (!res.data) {
      throw new Error("GET /api/v1/stats returned no data");
    }
    return res.data;
  }

  /**
   * Fetch leaderboard.
   * GET /api/v1/leaderboard → { success, data: LeaderboardEntry[] }
   */
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const res = await this.get<{ success: boolean; data?: LeaderboardEntry[] }>(
      "/api/v1/leaderboard"
    );
    return res.data ?? [];
  }

  // ───── WebSocket Convenience ─────

  /**
   * Connect to the WebSocket and subscribe to the given broadcast channels.
   * Replaces any existing managed socket (the previous one is disconnected first).
   *
   * @param channels   Broadcast channels: any of "prices", "stats", "funding".
   * @param onMessage  Receives every parsed message (price_update, stats_update,
   *                   funding_update, and user-targeted notifications).
   * @param opts.userAddress  Subscribe to user-targeted notifications (e.g. KEEPER_FAILURE).
   * @param opts.onError      Error callback.
   */
  connectAndSubscribe(
    channels: WsChannel[],
    onMessage: (msg: WsMessage) => void,
    opts?: { userAddress?: string; onError?: (err: Error) => void }
  ) {
    // Tear down any prior connection to avoid leaking sockets/timers.
    this.ws.disconnect();

    this.ws = new RealyxWs({
      url: this.wsUrl,
      apiKey: this.apiKey,
      onMessage,
      onError: opts?.onError,
    });

    // Queue subscriptions before connecting; RealyxWs flushes them on open
    // (and re-flushes automatically after any reconnect).
    for (const channel of channels) {
      this.ws.subscribe(channel);
    }
    if (opts?.userAddress) {
      this.ws.subscribeUser(opts.userAddress);
    }
    this.ws.connect();
  }

  /**
   * Disconnect WebSocket.
   */
  disconnectWs() {
    this.ws.disconnect();
  }

  // ───── Subaccount Helpers ─────

  /**
   * Returns true if this client is configured for subaccount (delegated) trading.
   */
  isSubaccountMode(): boolean {
    return !!this.subaccount;
  }

  /**
   * Get the owner address (the one that owns positions and pays collateral).
   */
  getOwnerAddress(): string | undefined {
    return this.subaccount?.ownerAddress;
  }

  /**
   * Get the bot address (the one that signs transactions and pays gas).
   */
  getBotAddress(): string | undefined {
    if (this.subaccount) {
      return new ethers.Wallet(this.subaccount.botPrivateKey).address;
    }
    return undefined;
  }
}
