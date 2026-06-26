/**
 * RealyxWs — Managed WebSocket wrapper with auto-reconnect, heartbeat, and
 * subscriptions.
 *
 * Protocol (matches backend/src/wsServer.ts):
 *  - Channel subscribe:  { type: "subscribe", channels: ["prices","stats","funding"] }
 *    The server stores the *latest* channel list per connection (replace
 *    semantics), so we always send the full active set.
 *  - User subscribe:     { type: "subscribe:user", address: "0x…" }
 *  - App-level heartbeat: { type: "ping", ts } → server replies { type: "pong", ts }
 *  - Inbound broadcasts:  price_update / funding_update / stats_update and
 *    user-targeted notifications such as KEEPER_FAILURE.
 */

import WebSocket from "ws";
import type { WsChannel, WsMessage } from "./types";

export type WsState = "connecting" | "connected" | "disconnected" | "reconnecting";

export interface RealyxWsOptions {
  /** WebSocket server URL (e.g. wss://app.realyx.example/ws) */
  url: string;
  /** API key (reserved; the backend WS server does not currently authenticate) */
  apiKey?: string;
  /** Reconnect delay in ms (default 1000, exponential backoff up to 30s) */
  reconnectDelay?: number;
  /** Maximum reconnect attempts before giving up (default Infinity) */
  maxReconnectAttempts?: number;
  /** Heartbeat ping interval in ms (default 30_000) */
  pingInterval?: number;
  /**
   * How long to wait for a pong after a ping before treating the socket as
   * dead and forcing a reconnect (default 10_000).
   */
  pongTimeout?: number;
  /** Callback invoked on every parsed message */
  onMessage?: (msg: WsMessage) => void;
  /** Callback on connection state change */
  onStateChange?: (state: WsState) => void;
  /** Callback on error */
  onError?: (err: Error) => void;
}

export class RealyxWs {
  private readonly _url: string;
  private apiKey?: string;
  private ws: WebSocket | null = null;
  private reconnectDelay: number;
  private maxReconnectAttempts: number;
  private pingInterval: number;
  private pongTimeout: number;
  private onMessage?: (msg: WsMessage) => void;
  private onStateChange?: (state: WsState) => void;
  private onError?: (err: Error) => void;

  /** Active broadcast channels (replace-semantics on the server). */
  private channels: Set<WsChannel> = new Set();
  /** Lowercased trader address for user-targeted notifications, if any. */
  private userAddress: string | null = null;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private state: WsState = "disconnected";

  constructor(opts: RealyxWsOptions) {
    this._url = opts.url;
    this.apiKey = opts.apiKey;
    this.reconnectDelay = opts.reconnectDelay ?? 1000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? Infinity;
    this.pingInterval = opts.pingInterval ?? 30_000;
    this.pongTimeout = opts.pongTimeout ?? 10_000;
    this.onMessage = opts.onMessage;
    this.onStateChange = opts.onStateChange;
    this.onError = opts.onError;
  }

  /** The configured WebSocket URL. */
  get url(): string {
    return this._url;
  }

  get currentState(): WsState {
    return this.state;
  }

  /** Connect to the WebSocket server */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionalClose = false;
    this.setState("connecting");

    const ws = new WebSocket(this._url);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.startPing();

      // Re-send the full subscription state on (re)connect.
      this.sendChannels();
      if (this.userAddress) {
        this.safeSend(ws, { type: "subscribe:user", address: this.userAddress });
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

      let msg: WsMessage;
      try {
        msg = JSON.parse(raw) as WsMessage;
      } catch {
        // Ignore malformed messages
        return;
      }

      // Resolve the app-level pong heartbeat internally.
      if (msg.type === "pong") {
        this.clearPongTimer();
        return;
      }
      this.onMessage?.(msg);
    });

    ws.on("pong", () => {
      // Protocol-level pong (server's heartbeat ping → ws auto-pong) also
      // counts as liveness.
      this.clearPongTimer();
    });

    ws.on("close", () => {
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

  /**
   * Subscribe to a broadcast channel. Valid channels: "prices", "stats",
   * "funding". The full active set is resent to the server on every change.
   */
  subscribe(channel: WsChannel) {
    if (!this.channels.has(channel)) {
      this.channels.add(channel);
      this.sendChannels();
    }
  }

  /** Unsubscribe from a broadcast channel. */
  unsubscribe(channel: WsChannel) {
    if (this.channels.delete(channel)) {
      this.sendChannels();
    }
  }

  /** Subscribe to all market price ticks. */
  subscribePrices() {
    this.subscribe("prices");
  }

  /** Subscribe to protocol-wide stats updates. */
  subscribeStats() {
    this.subscribe("stats");
  }

  /** Subscribe to funding-rate updates. */
  subscribeFunding() {
    this.subscribe("funding");
  }

  /**
   * Subscribe to user-targeted notifications (e.g. KEEPER_FAILURE) for a
   * specific trader address.
   */
  subscribeUser(address: string) {
    const addr = address.toLowerCase();
    this.userAddress = addr;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.safeSend(this.ws, { type: "subscribe:user", address: addr });
    }
  }

  /** The set of channels currently subscribed. */
  get activeChannels(): WsChannel[] {
    return [...this.channels];
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
    this.channels.clear();
    this.userAddress = null;
    this.setState("disconnected");
  }

  /** Push the current channel set to the server (replace semantics). */
  private sendChannels() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.safeSend(this.ws, { type: "subscribe", channels: [...this.channels] });
    }
  }

  private safeSend(ws: WebSocket, payload: unknown) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private setState(s: WsState) {
    this.state = s;
    this.onStateChange?.(s);
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState("disconnected");
      this.onError?.(new Error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`));
      return;
    }
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
        // App-level ping (the backend understands { type: "ping" } and replies
        // with { type: "pong" }). A protocol-level ping is sent too so liveness
        // works even if app handling changes.
        this.safeSend(this.ws, { type: "ping", ts: Date.now() });
        try {
          this.ws.ping();
        } catch {
          /* ignore */
        }
        // Expect a pong within pongTimeout, otherwise force-close → reconnect.
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = setTimeout(() => {
          if (this.ws) {
            try {
              this.ws.terminate();
            } catch {
              /* ignore */
            }
          }
        }, this.pongTimeout);
      }
    }, this.pingInterval);
  }

  private clearPongTimer() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
  }
}
