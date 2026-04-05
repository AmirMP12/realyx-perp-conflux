import { useEffect, useRef, useCallback, useState } from 'react';
import { useMarketsStore, useStatsStore } from '../stores';

const WS_URL = (import.meta.env.VITE_WS_URL ?? "").trim() || (import.meta.env.DEV ? "ws://localhost:3002" : "");

interface WSMessage {
    type: string;
    data: Record<string, unknown> & { marketAddress?: string; price?: number; change24h?: number; rate?: number; volume24h?: string; totalMarkets?: number };
    marketAddress?: string;
}

export function useWebSocket() {
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

    const updateMarketByAddress = useMarketsStore((s) => s.updateMarketByAddress);
    const setStats = useStatsStore((s) => s.setStats);

    const connect = useCallback(() => {
        if (typeof window === 'undefined' || !WS_URL) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        try {
            const ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                setConnected(true);
                ws.send(JSON.stringify({ type: 'subscribe', channels: ['prices', 'stats'] }));
            };

            ws.onmessage = (event) => {
                try {
                    const msg: WSMessage = JSON.parse(event.data);

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
                reconnectTimeoutRef.current = setTimeout(connect, 3000);
            };

            ws.onerror = () => ws.close();

            wsRef.current = ws;
        } catch (err) {
            console.error('Failed to connect WebSocket:', err);
            reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
    }, [updateMarketByAddress, setStats]);

    useEffect(() => {
        connect();

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connect]);

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

/** Live PnL = (markPrice - entryPrice) * size for long, (entryPrice - markPrice) * size for short */
export function useLivePnL<T extends { marketAddress: string; entryPrice: string; size: string; isLong: boolean; pnl: string }>(
    positions: T[],
    markets: { marketAddress?: string; indexPrice?: number }[]
): (T & { livePnl: number; markPrice: number })[] {
    return positions.map((pos) => {
        const market = markets.find((m) => (m.marketAddress || '').toLowerCase() === (pos.marketAddress || '').toLowerCase());
        const markPrice = market?.indexPrice ?? parseFloat(pos.entryPrice);
        const entry = parseFloat(pos.entryPrice);
        const size = parseFloat(pos.size);
        const livePnl = pos.isLong ? (markPrice - entry) * size : (entry - markPrice) * size;
        return { ...pos, livePnl, markPrice };
    });
}
