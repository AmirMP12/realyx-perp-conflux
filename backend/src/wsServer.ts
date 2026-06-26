/**
 * WebSocket server for real-time price and stats broadcasts.
 * Polls Pyth/API and pushes to connected clients.
 */

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { config } from "./config.js";
import { fetchPythPrices, fetchPyth24hChange } from "./services/pyth.js";
import { fetchMarkets, fetchProtocol } from "./services/indexer.js";
import { getActiveMarketAddresses } from "./services/activeMarkets.js";
import { setWsConnections } from "./middleware/metrics.js";

const POLL_MS = process.env.NODE_ENV === "test" ? 500 : 15_000; // fast polling for tests
const isTestEnv = process.env.NODE_ENV === "test";

/**
 * User-specific WebSocket client tracking.
 * Key: lowercased trader address, Value: set of connected WebSockets for that user.
 */
const userClients = new Map<string, Set<WebSocket>>();

/**
 * Broadcast a JSON payload to all WebSocket clients subscribed for a specific user address.
 */
export function broadcastToUser(traderAddress: string, type: string, data: any) {
  const addr = traderAddress.toLowerCase();
  const sockets = userClients.get(addr);
  if (!sockets || sockets.size === 0) return;
  const payload = JSON.stringify({ type, data, traderAddress: addr });
  sockets.forEach((ws) => {
    if (ws.readyState !== 1) {
      sockets?.delete(ws);
      return;
    }
    try {
      ws.send(payload);
    } catch (err) {
      if (!isTestEnv) console.error("[ws] send-to-user error:", err);
    }
  });
}

/**
 * Keeper failure broadcast hook — callable from the keeper router.
 * Pushes a KEEPER_FAILURE notification to the specific user's WebSocket.
 */
export function broadcastKeeperFailure(data: { orderId: string; traderAddress: string; failureReason: string }) {
  broadcastToUser(data.traderAddress, "KEEPER_FAILURE", {
    orderId: data.orderId,
    failureReason: data.failureReason,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

/**
 * Start the realtime WebSocket broadcaster.
 *
 * On a single-port host (Railway, Heroku, …) only `$PORT` is routable, so pass
 * an existing HTTP `server` to attach the WS upgrade handler to that same port
 * (see `wsWorker.ts`). When no server is supplied the broadcaster binds its own
 * `config.wsPort`, which suits local dev and multi-port hosts.
 */
export function startWsServer(opts: { server?: Server } = {}) {
  const wss = opts.server
    ? new WebSocketServer({ server: opts.server })
    : new WebSocketServer({ port: config.wsPort });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    clients.add(ws);
    setWsConnections(clients.size);
    (ws as any).isAlive = true;
    ws.on("pong", () => { (ws as any).isAlive = true; });

    const ip = req.socket.remoteAddress ?? "unknown";
    if (!isTestEnv) console.info(`[ws] Client connected, total: ${clients.size}, ip: ${ip}`);
    ws.on("message", (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Application-level liveness: browsers can't reply to protocol-level
        // pings, so the client sends { type: "ping" } and expects a pong back.
        if (msg.type === "ping") {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify({ type: "pong", ts: msg.ts ?? Date.now() }));
            } catch {
              /* ignore send failure; client heartbeat will reconnect */
            }
          }
          return;
        }
        if (msg.type === "subscribe" && Array.isArray(msg.channels)) {
          (ws as any).channels = msg.channels;
        }
        // User-specific subscription: frontend sends { type: "subscribe:user", address: "0x..." }
        if (msg.type === "subscribe:user" && typeof msg.address === "string" && msg.address.startsWith("0x")) {
          const addr = msg.address.toLowerCase();
          (ws as any).traderAddress = addr;
          if (!userClients.has(addr)) {
            userClients.set(addr, new Set());
          }
          userClients.get(addr)!.add(ws);
          if (!isTestEnv) console.info(`[ws] User subscribed: ${addr}`);
        }
      } catch {
        /* ignore invalid message */
      }
    });
    ws.on("close", () => {
      clients.delete(ws);
      setWsConnections(clients.size);
      // Clean up user-specific tracking
      const traderAddr = (ws as any).traderAddress as string | undefined;
      if (traderAddr) {
        const userSet = userClients.get(traderAddr);
        if (userSet) {
          userSet.delete(ws);
          if (userSet.size === 0) userClients.delete(traderAddr);
        }
      }
      if (!isTestEnv) console.info(`[ws] Client disconnected, total: ${clients.size}`);
    });
    ws.on("error", () => clients.delete(ws));
  });

  const CHANNEL_MAP: Record<string, string> = { price_update: "prices", stats_update: "stats", funding_update: "funding" };
  function broadcast(type: string, data: any, marketAddress?: string) {
    const payload = JSON.stringify({ type, data, marketAddress });
    const channel = CHANNEL_MAP[type];
    clients.forEach((ws) => {
      if (ws.readyState !== 1) return;
      const ch = (ws as any).channels as string[] | undefined;
      if (channel && ch && ch.length > 0 && !ch.includes(channel)) return;
      try {
        ws.send(payload);
      } catch (err) {
        if (!isTestEnv) console.error("[ws] send error:", err);
      }
    });
  }

  let lastMarkets: Awaited<ReturnType<typeof fetchMarkets>> = [];
  let lastProtocol: Awaited<ReturnType<typeof fetchProtocol>> = null;
  let lastPythPrices: Record<string, number> = {};

  async function poll() {
    try {
      const [pythPrices, markets, protocol] = await Promise.all([
        fetchPythPrices(),
        fetchMarkets(),
        fetchProtocol(),
      ]);
      lastPythPrices = pythPrices;
      lastMarkets = markets;
      lastProtocol = protocol;
      broadcastData(pythPrices, markets, protocol);
    } catch (err) {
      if (!isTestEnv) console.error("[ws] poll error:", err);
      if (lastMarkets.length > 0 || lastProtocol) {
        broadcastData(lastPythPrices, lastMarkets, lastProtocol).catch(() => {});
      }
    }
  }

  async function broadcastData(
    pythPrices: Record<string, number>,
    markets: Awaited<ReturnType<typeof fetchMarkets>>,
    protocol: Awaited<ReturnType<typeof fetchProtocol>>
  ) {
    const activeSet = await getActiveMarketAddresses();
    const filtered = activeSet && activeSet.size > 0
      ? markets.filter((m) => {
          const addr = String(m.marketAddress).toLowerCase();
          return activeSet.has(addr);
        })
      : markets;

    for (const m of filtered) {
      const addr = String(m.marketAddress).toLowerCase();
      const price = pythPrices[addr];
      if (price != null && price > 0) {
        // Real 24h change (Pyth Benchmarks, internally cached ~5min) instead of
        // the previous hard-coded 0 which made every ticker show a flat 0.00%.
        // Best-effort: never let an enrichment hiccup drop the price tick.
        let change24h = 0;
        try {
          const c = await fetchPyth24hChange(addr);
          if (typeof c === "number" && Number.isFinite(c)) change24h = c;
        } catch {
          /* keep change24h = 0; price still broadcasts */
        }
        broadcast("price_update", {
          price,
          marketAddress: addr,
          change24h,
        }, addr);
      }

      // Funding channel: previously defined in CHANNEL_MAP but never emitted, so
      // the live funding countdown only ever moved on REST polling. Push the
      // indexed instantaneous funding rate so subscribers update in real time.
      // `fetchMarkets` carries the raw 1e18-scaled rate; normalize to the same
      // human scale the REST `/api/markets` route emits so the two agree.
      const rawFunding = Number(m.fundingRate);
      if (Number.isFinite(rawFunding)) {
        const rate = Number((rawFunding / 1e18).toFixed(6));
        broadcast("funding_update", { rate, marketAddress: addr }, addr);
      }
    }

    let totalOI = 0;
    for (const m of filtered) {
      totalOI += Number(m.totalLongSize) + Number(m.totalShortSize);
    }
    // `volume24hUsd` / `totalVolumeUsd` from the indexer are already human USD
    // (the SQL divides by 1e18), so emit them as-is — matching the REST `/stats`
    // route. Open interest sums raw 1e18-scaled sizes, so normalize by 1e18
    // (not 1e12) so WS and REST report the same numbers.
    broadcast("stats_update", {
      volume24h: protocol?.volume24hUsd ? Number(protocol.volume24hUsd).toFixed(6) : "0",
      cumulativeVolumeUsd: protocol?.totalVolumeUsd ? Number(protocol.totalVolumeUsd).toFixed(6) : "0",
      totalOpenInterest: (totalOI / 1e18).toFixed(6),
      totalMarkets: filtered.length,
    });
  }

  const heartbeatInterval = setInterval(() => {
    clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  const interval = setInterval(poll, POLL_MS);
  poll();

  if (!isTestEnv) {
    const where = opts.server ? "attached to HTTP server ($PORT)" : `port ${config.wsPort}`;
    console.info(`[ws] Server listening (${where})`);
  }
  return () => {
    clearInterval(interval);
    clearInterval(heartbeatInterval);
    wss.close();
  };
}
