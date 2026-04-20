/**
 * WebSocket server for real-time price and stats broadcasts.
 * Polls Pyth/API and pushes to connected clients.
 */
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { fetchPythPrices } from "./services/pyth.js";
import { fetchMarkets, fetchProtocol } from "./services/indexer.js";
import { getActiveMarketAddresses } from "./services/activeMarkets.js";
import { toDecimal } from "./utils/format.js";
const POLL_MS = process.env.NODE_ENV === "test" ? 500 : 15_000; // fast polling for tests
const isTestEnv = process.env.NODE_ENV === "test";
const MARKET_META = {
    "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": { name: "Conflux", symbol: "CFX-USD" },
    "0x986a383f6de4a24dd3f524f0f93546229b58265f": { name: "Bitcoin", symbol: "BTC-USD" },
    "0x886a383f6de4a24dd3f524f0f93546229b58265f": { name: "Ethereum", symbol: "ETH-USD" },
    "0x286a383f6de4a24dd3f524f0f93546229b58265f": { name: "Tether Gold", symbol: "XAUT-USD" },
    "0x786a383f6de4a24dd3f524f0f93546229b58265f": { name: "NVIDIA", symbol: "NVDAX-USD" },
    "0x686a383f6de4a24dd3f524f0f93546229b58265f": { name: "Tesla", symbol: "TSLAX-USD" },
    "0x586a383f6de4a24dd3f524f0f93546229b58265f": { name: "Meta", symbol: "METAX-USD" },
    "0x486a383f6de4a24dd3f524f0f93546229b58265f": { name: "Circle", symbol: "CRCLX-USD" },
    "0x386a383f6de4a24dd3f524f0f93546229b58265f": { name: "Alphabet", symbol: "GOOGLX-USD" },
    "0x116a383f6de4a24dd3f524f0f93546229b58265f": { name: "MicroStrategy", symbol: "MSTRX-USD" },
};
function _getMeta(addr) {
    const key = addr.toLowerCase();
    return MARKET_META[key] ?? { name: addr.slice(0, 10), symbol: addr.slice(0, 10) };
}
export function startWsServer() {
    const wss = new WebSocketServer({ port: config.wsPort });
    const clients = new Set();
    wss.on("connection", (ws, req) => {
        clients.add(ws);
        ws.isAlive = true;
        ws.on("pong", () => { ws.isAlive = true; });
        const ip = req.socket.remoteAddress ?? "unknown";
        if (!isTestEnv)
            console.info(`[ws] Client connected, total: ${clients.size}, ip: ${ip}`);
        ws.on("message", (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === "subscribe" && Array.isArray(msg.channels)) {
                    ws.channels = msg.channels;
                }
            }
            catch {
                /* ignore invalid message */
            }
        });
        ws.on("close", () => {
            clients.delete(ws);
            if (!isTestEnv)
                console.info(`[ws] Client disconnected, total: ${clients.size}`);
        });
        ws.on("error", () => clients.delete(ws));
    });
    const CHANNEL_MAP = { price_update: "prices", stats_update: "stats", funding_update: "funding" };
    function broadcast(type, data, marketAddress) {
        const payload = JSON.stringify({ type, data, marketAddress });
        const channel = CHANNEL_MAP[type];
        clients.forEach((ws) => {
            if (ws.readyState !== 1)
                return;
            const ch = ws.channels;
            if (channel && ch && ch.length > 0 && !ch.includes(channel))
                return;
            try {
                ws.send(payload);
            }
            catch (err) {
                if (!isTestEnv)
                    console.error("[ws] send error:", err);
            }
        });
    }
    let lastMarkets = [];
    let lastProtocol = null;
    let lastPythPrices = {};
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
        }
        catch (err) {
            if (!isTestEnv)
                console.error("[ws] poll error:", err);
            if (lastMarkets.length > 0 || lastProtocol) {
                broadcastData(lastPythPrices, lastMarkets, lastProtocol).catch(() => { });
            }
        }
    }
    async function broadcastData(pythPrices, markets, protocol) {
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
                broadcast("price_update", {
                    price,
                    marketAddress: addr,
                    change24h: 0,
                }, addr);
            }
        }
        let totalOI = 0;
        for (const m of filtered) {
            totalOI += Number(m.totalLongSize) + Number(m.totalShortSize);
        }
        broadcast("stats_update", {
            volume24h: protocol?.totalVolumeUsd ? toDecimal(protocol.totalVolumeUsd) : "0",
            totalOpenInterest: (totalOI / 1e12).toFixed(6),
            totalMarkets: filtered.length,
        });
    }
    const heartbeatInterval = setInterval(() => {
        clients.forEach((ws) => {
            if (ws.isAlive === false)
                return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30_000);
    const interval = setInterval(poll, POLL_MS);
    poll();
    if (!isTestEnv)
        console.info(`[ws] Server listening on port ${config.wsPort}`);
    return () => {
        clearInterval(interval);
        clearInterval(heartbeatInterval);
        wss.close();
    };
}
