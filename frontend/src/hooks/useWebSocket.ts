import { useEffect, useRef, useCallback, useState } from 'react';
import { useMarketsStore, useStatsStore } from '../stores';

const WS_URL = (import.meta.env.VITE_WS_URL ?? "").trim() || (import.meta.env.DEV ? "ws://localhost:3002" : "");

interface WSMessage {
    type: string;
    data?: Record<string, unknown> & { marketAddress?: string; price?: number; change24h?: number; rate?: number; volume24h?: string; totalMarkets?: number };
    marketAddress?: string;
    ts?: number;
}

// Reconnect backoff tuning.
const RECONNECT_BASE_MS = 1_000; // first retry delay
const RECONNECT_MAX_MS = 30_000; // ceiling for exponential growth
const RECONNECT_JITTER = 0.3; // ±30% randomization to avoid thundering herd
// Heartbeat / liveness.
const HEARTBEAT_INTERVAL_MS = 15_000; // send a ping this often
const HEARTBEAT_TIMEOUT_MS = 10_000; // close if no message arrives in this window after a ping

export function useWebSocket() {
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const reconnectAttemptsRef = useRef(0);
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval>>();
    const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    // Set when the component unmounts so an in-flight close handler doesn't
    // schedule a reconnect after teardown.
    const closedByUnmountRef = useRef(false);

    const updateMarketByAddress = useMarketsStore((s) => s.updateMarketByAddress);
    const setStats = useStatsStore((s) => s.setStats);

    const clearTimers = useCallback(() => {
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        if (heartbeatTimeoutRef.current) clearTimeout(heartbeatTimeoutRef.current);
        heartbeatIntervalRef.current = undefined;
        heartbeatTimeoutRef.current = undefined;
    }, []);

    // Exponential backoff with jitter, computed from the attempt counter.
    const nextReconnectDelay = useCallback(() => {
        const attempt = reconnectAttemptsRef.current;
        reconnectAttemptsRef.current = attempt + 1;
        const base = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
        const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
        return Math.max(RECONNECT_BASE_MS, Math.round(base + jitter));
    }, []);

    const connect = useCallback(() => {
        if (typeof window === 'undefined' || !WS_URL) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        // Exponential backoff with jitter. The first connect runs immediately;
        // subsequent reconnects are scheduled by `onclose`.
        const startHeartbeat = (ws: WebSocket) => {
            clearTimers();
            heartbeatIntervalRef.current = setInterval(() => {
                if (ws.readyState !== WebSocket.OPEN) return;
                try {
                    ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
                } catch {
                    // send failed — let the timeout below force a reconnect
                }
                // If nothing comes back (pong or any message) in time, assume a
                // dead connection and close so `onclose` triggers a reconnect.
                if (heartbeatTimeoutRef.current) clearTimeout(heartbeatTimeoutRef.current);
                heartbeatTimeoutRef.current = setTimeout(() => {
                    try {
                        ws.close();
                    } catch {
                        /* noop */
                    }
                }, HEARTBEAT_TIMEOUT_MS);
            }, HEARTBEAT_INTERVAL_MS);
        };

        // Any inbound message proves the link is alive — cancel the pending
        // liveness timeout.
        const markAlive = () => {
            if (heartbeatTimeoutRef.current) {
                clearTimeout(heartbeatTimeoutRef.current);
                heartbeatTimeoutRef.current = undefined;
            }
        };

        try {
            const ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                setConnected(true);
                reconnectAttemptsRef.current = 0; // reset backoff on a healthy connect
                ws.send(JSON.stringify({ type: 'subscribe', channels: ['prices', 'stats', 'funding'] }));
                startHeartbeat(ws);
            };

            ws.onmessage = (event) => {
                markAlive();
                try {
                    const msg: WSMessage = JSON.parse(event.data);

                    // Server liveness reply — already handled by `markAlive`.
                    if (msg.type === 'pong' || msg.type === 'ping') return;

                    switch (msg.type) {
                        case 'price_update': {
                            const addr = msg.marketAddress || msg.data?.marketAddress;
                            const price = msg.data?.price ?? msg.data?.indexPrice;
                            if (addr && price != null && Number(price) > 0) {
                                updateMarketByAddress(String(addr), {
                                    indexPrice: Number(price),
                                    change24h: Number(msg.data?.change24h ?? 0),
                                    lastUpdate: new Date().toISOString(),
                                });
                            }
                            break;
                        }
                        case 'stats_update':
                            if (msg.data) {
                                setStats({
                                    volume24h: Number(msg.data.volume24h ?? 0),
                                    markets: Number(msg.data.totalMarkets ?? msg.data.markets ?? 0),
                                });
                            }
                            break;
                        case 'funding_update': {
                            const addr = msg.marketAddress || msg.data?.marketAddress;
                            if (addr && msg.data?.rate != null) {
                                updateMarketByAddress(String(addr), { fundingRate: Number(msg.data.rate) });
                            }
                            break;
                        }
                    }
                } catch (err) {
                    console.error('Failed to parse WS message:', err);
                }
            };

            ws.onclose = () => {
                setConnected(false);
                clearTimers();
                if (closedByUnmountRef.current) return;
                reconnectTimeoutRef.current = setTimeout(connect, nextReconnectDelay());
            };

            ws.onerror = () => ws.close();

            wsRef.current = ws;
        } catch (err) {
            console.error('Failed to connect WebSocket:', err);
            if (!closedByUnmountRef.current) {
                reconnectTimeoutRef.current = setTimeout(connect, nextReconnectDelay());
            }
        }
    }, [updateMarketByAddress, setStats, clearTimers, nextReconnectDelay]);

    useEffect(() => {
        closedByUnmountRef.current = false;
        connect();

        return () => {
            closedByUnmountRef.current = true;
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            clearTimers();
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connect, clearTimers]);

    const send = useCallback((message: unknown) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(message));
        }
    }, []);

    return { connected, send };
}

export function useRealtimePrices() {
    const { connected } = useWebSocket();
    const markets = useMarketsStore((s) => s.markets);
    return { connected, markets };
}

/** Live PnL = size * (markPrice - entryPrice) / entryPrice for long, size * (entryPrice - markPrice) / entryPrice for short.
 *  Matches on-chain PositionMath.calculateUnrealizedPnL where size is USD notional, not asset quantity.
 *
 *  NOTE: this is *price* PnL only — it deliberately excludes accrued funding,
 *  which is not available client-side without an extra on-chain read. Funding
 *  is settled on-chain at close, so for a position held across several 8h
 *  funding intervals this figure can drift from the realized close value. The
 *  UI labels the column accordingly (PnL*) so the number is never presented as
 *  funding-inclusive. For authoritative risk/PnL the UI reads getPositionPnL /
 *  getAccountRisk (see useAccountRisk). */
export function useLivePnL<T extends { marketAddress: string; entryPrice: string; size: string; isLong: boolean; pnl: string }>(
    positions: T[],
    markets: { marketAddress?: string; indexPrice?: number }[]
): (T & { livePnl: number; markPrice: number })[] {
    return positions.map((pos) => {
        const market = markets.find((m) => (m.marketAddress || '').toLowerCase() === (pos.marketAddress || '').toLowerCase());
        const entryRaw = parseFloat(pos.entryPrice);
        const entry = Number.isFinite(entryRaw) ? entryRaw : 0;
        const sizeRaw = parseFloat(pos.size);
        const size = Number.isFinite(sizeRaw) ? sizeRaw : 0;
        const markRaw = market?.indexPrice ?? entry;
        const markPrice = Number.isFinite(markRaw) ? markRaw : entry;
        const livePnl = entry > 0
            ? (pos.isLong ? (markPrice - entry) * size / entry : (entry - markPrice) * size / entry)
            : 0;
        return { ...pos, livePnl, markPrice };
    });
}
