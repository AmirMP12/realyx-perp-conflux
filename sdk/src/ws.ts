/**
 * RealyxWs — Managed WebSocket wrapper with auto-reconnect, heartbeat, and subscriptions.
 */

import WebSocket from "ws";
import type { WsMessage } from "./types";

export interface RealyxWsOptions {
  /** WebSocket server URL (e.g. wss://ws.realyx.xyz) */
  url: string;
  /** API key for authenticated channels (positions, orders) */
  apiKey?: string;
  /** Reconnect delay in ms (default 1000, exponential backoff up to 30s) */
  reconnectDelay?: number;
  /** Heartbeat ping interval in ms (default 30_000) */
  pingInterval?: number;
  /** Callback invoked on every parsed message */
  onMessage?: (msg: WsMessage) => void;
  /** Callback on connection state change */
  onStateChange?: (state: "connecting" | "connected" | "disconnected" | "reconnecting") => void;
  /** Callback on error */
  onError?: (err: Error) => void;
}

export class RealyxWs {
  private url: string;
  private apiKey?: string;
  private ws: WebSocket | null = null;
  private reconnectDelay: number;
  private pingInterval: number;
  private onMessage?: (msg: WsMessage) => void;
  private onStateChange?: (state: "connecting" | "connected" | "disconnected" | "reconnecting") => void;
  private onError?: (err: Error) => void;

  private subscriptions: Set<string> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private state: "connecting" | "connected" | "disconnected" | "reconnecting" = "disconnected";

  constructor(opts: RealyxWsOptions) {
    this.url = opts.url;
    this.apiKey = opts.apiKey;
    this.reconnectDelay = opts.reconnectDelay ?? 1000;
    this.pingInterval = opts.pingInterval ?? 30_000;
    this.onMessage = opts.onMessage;
    this.onStateChange = opts.onStateChange;
    this.onError = opts.onError;
  }

  get currentState() {
    return this.state;
  }

  /** Connect to the WebSocket server */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionalClose = false;
    this.setState("connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.startPing();

      // Authenticate if we have an API key
      if (this.apiKey) {
        ws.send(JSON.stringify({ type: "auth", apiKey: this.apiKey }));
      }

      // Re-subscribe to previously active channels
      for (const channel of this.subscriptions) {
        ws.send(JSON.stringify({ type: "subscribe", channel }));
      }
    });

    ws.on("message", (data: WebSocket.Data) => {
      let raw: string;
      if (Buffer.isBuffer(data)) {
        raw = data.toString("utf-8");
      } else if (data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(data);
      } else {
        raw = data as string;
      }

      try {
        const msg = JSON.parse(raw) as WsMessage;
        this.onMessage?.(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", (code: number) => {
      this.stopPing();
      if (!this.intentionalClose) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }
    });

    ws.on("error", (err: Error) => {
      this.onError?.(err);
      // The close event will fire after error, triggering reconnect
    });
  }

  /** Subscribe to a channel (e.g. "price:BTC", "trades:*", "orderbook:ETH") */
  subscribe(channel: string) {
    this.subscriptions.add(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", channel }));
    }
  }

  /** Unsubscribe from a channel */
  unsubscribe(channel: string) {
    this.subscriptions.delete(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", channel }));
    }
  }

  /** Subscribe to all price feeds for a set of symbols */
  subscribePrices(symbols: string[]) {
    for (const sym of symbols) {
      this.subscribe(`price:${sym}`);
    }
  }

  /** Subscribe to trades for a set of symbols */
  subscribeTrades(symbols: string[]) {
    for (const sym of symbols) {
      this.subscribe(`trades:${sym}`);
    }
  }

  /** Subscribe to position updates (requires authentication) */
  subscribePositions() {
    this.subscribe("positions");
  }

  /** Gracefully disconnect (no reconnect) */
  disconnect() {
    this.intentionalClose = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.subscriptions.clear();
    this.setState("disconnected");
  }

  private setState(s: "connecting" | "connected" | "disconnected" | "reconnecting") {
    this.state = s;
    this.onStateChange?.(s);
  }

  private scheduleReconnect() {
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30_000 // max 30s
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.pingInterval);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}