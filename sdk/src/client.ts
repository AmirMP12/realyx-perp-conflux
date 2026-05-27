/**
 * RealyxClient — Main SDK entry point.
 * Provides REST helpers for markets, positions, trades, and a managed WebSocket.
 */

import { ethers } from "ethers";
import { RealyxWs } from "./ws";
import { OrderBuilder } from "./orders";
import type { RealyxConfig, SubaccountConfig, Market, Position, WsMessage, OrderParams } from "./types";

export class RealyxClient {
  public readonly config: RealyxConfig;
  public ws: RealyxWs;
  public readonly orders: OrderBuilder;

  private apiBaseUrl: string;
  private apiKey?: string;
  private subaccount?: SubaccountConfig;

  constructor(config: RealyxConfig) {
    this.config = config;
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, ""); // strip trailing slash
    this.apiKey = config.apiKey;
    this.subaccount = config.subaccount;

    // Wire up signer for OrderBuilder
    let signer: ethers.Signer;
    if (config.subaccount) {
      const provider = config.subaccount.provider ?? ethers.getDefaultProvider();
      signer = new ethers.Wallet(config.subaccount.botPrivateKey, provider);
    } else {
      // For direct trading, user must provide a signer separately or use orders.setSigner()
      signer = ethers.Wallet.createRandom().connect(ethers.getDefaultProvider());
    }

    // TODO: This should be configurable
    const tradingCoreAddress = process.env.TRADING_CORE_ADDRESS ?? ethers.ZeroAddress;

    this.orders = new OrderBuilder({
      signer,
      tradingCoreAddress,
      subaccount: config.subaccount,
    });

    this.ws = new RealyxWs({
      url: config.wsUrl ?? this.apiBaseUrl.replace(/^http/, "ws") + "/ws",
      apiKey: config.apiKey,
      onMessage: undefined, // user sets callbacks
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
    const res = await fetch(`${this.apiBaseUrl}${path}`, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${path} failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Fetch all active markets.
   * GET /api/v1/markets
   */
  async getMarkets(): Promise<Market[]> {
    const data = await this.get<{ success: boolean; markets?: Market[]; data?: Market[] }>("/api/v1/markets");
    return data.markets ?? data.data ?? [];
  }

  /**
   * Fetch positions for a user address.
   * GET /api/v1/user/:address/positions
   */
  async getPositions(address: string): Promise<Position[]> {
    const data = await this.get<{ success: boolean; positions?: Position[]; data?: Position[] }>(`/api/v1/user/${address}/positions`);
    return data.positions ?? data.data ?? [];
  }

  /**
   * Fetch trade history for a user address.
   * GET /api/v1/user/:address/trades
   */
  async getTrades(address: string): Promise<any[]> {
    const data = await this.get<{ success: boolean; trades?: any[]; data?: any[] }>(`/api/v1/user/${address}/trades`);
    return data.trades ?? data.data ?? [];
  }

  /**
   * Fetch stats (volume, open interest, etc.).
   * GET /api/v1/stats
   */
  async getStats(): Promise<any> {
    return this.get("/api/v1/stats");
  }

  /**
   * Fetch leaderboard.
   * GET /api/v1/leaderboard
   */
  async getLeaderboard(): Promise<any> {
    return this.get("/api/v1/leaderboard");
  }

  // ───── WebSocket Convenience ─────

  /**
   * Connect to WebSocket and subscribe to price feeds for given symbols.
   */
  connectAndSubscribe(symbols: string[], onMessage: (msg: WsMessage) => void, onError?: (err: Error) => void) {
    this.ws = new RealyxWs({
      url: this.ws["url"] ?? this.apiBaseUrl.replace(/^http/, "ws") + "/ws",
      apiKey: this.apiKey,
      onMessage,
      onError,
      onStateChange: (state) => {
        if (state === "connected") {
          for (const sym of symbols) {
            this.ws.subscribe(`price:${sym}`);
            this.ws.subscribe(`trades:${sym}`);
          }
        }
      },
    });
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
      // Derive from private key — the OrderBuilder's signer is the bot wallet
      return new ethers.Wallet(this.subaccount.botPrivateKey).address;
    }
    return undefined;
  }
}