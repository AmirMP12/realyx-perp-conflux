import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

const WS_URL = (import.meta.env.VITE_WS_URL ?? "").trim() || (import.meta.env.DEV ? "ws://localhost:3002" : "");

interface OrderNotification {
    id: string;
    type: 'ORDER_EXECUTED' | 'ORDER_PARTIALLY_FILLED' | 'ORDER_CANCELLED' | 'ORDER_EXPIRED' | 'POSITION_OPENED' | 'POSITION_CLOSED' | 'POSITION_LIQUIDATED';
    orderId?: number;
    positionId?: number;
    collectionId?: string;
    size?: number;
    filledSize?: number;
    executionPrice?: number;
    pnl?: number;
    timestamp: number;
    message: string;
}

interface NotificationSettings {
    orderExecuted: boolean;
    orderPartiallyFilled: boolean;
    orderCancelled: boolean;
    orderExpired: boolean;
    positionOpened: boolean;
    positionClosed: boolean;
    positionLiquidated: boolean;
    soundEnabled: boolean;
}

const defaultSettings: NotificationSettings = {
    orderExecuted: true,
    orderPartiallyFilled: true,
    orderCancelled: true,
    orderExpired: true,
    positionOpened: true,
    positionClosed: true,
    positionLiquidated: true,
    soundEnabled: false
};

export function useOrderNotifications() {
    const { address } = useAccount();
    const [connected, setConnected] = useState(false);
    const [notifications, setNotifications] = useState<OrderNotification[]>([]);
    const [settings, setSettings] = useState<NotificationSettings>(() => {
        const saved = localStorage.getItem('notificationSettings');
        return saved ? JSON.parse(saved) : defaultSettings;
    });
    const [ws, setWs] = useState<WebSocket | null>(null);

    useEffect(() => {
        localStorage.setItem('notificationSettings', JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        if (!address || !WS_URL) return;

        const websocket = new WebSocket(WS_URL);

        websocket.onopen = () => {
            setConnected(true);
            websocket.send(JSON.stringify({
                type: 'auth',
                data: { wallet: address, signature: '' } // In production, use actual signature
            }));
            websocket.send(JSON.stringify({
                type: 'subscribe',
                channel: `user:${address.toLowerCase()} `
            }));
        };

        websocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (err) {
                console.error('Failed to parse WebSocket message:', err);
            }
        };

        websocket.onclose = () => {
            setConnected(false);
        };

        websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            setConnected(false);
        };

        setWs(websocket);
        void ws;

        return () => {
            websocket.close();
        };
    }, [address]);

    const handleWebSocketMessage = useCallback((data: any) => {
        if (data.type === 'notification') {
            const notification = parseNotification(data.data);
            if (notification && shouldShowNotification(notification, settings)) {
                showNotification(notification);
                setNotifications((prev: any) => [notification, ...prev].slice(0, 50));
            }
        }
    }, [settings]);

    const parseNotification = (data: any): OrderNotification | null => {
        const timestamp = Date.now();

        switch (data.event) {
            case 'OrderExecuted':
                return {
                    id: `order - ${data.orderId} -${timestamp} `,
                    type: 'ORDER_EXECUTED',
                    orderId: data.orderId,
                    collectionId: data.collectionId,
                    filledSize: data.filledSize,
                    executionPrice: data.executionPrice,
                    timestamp,
                    message: `Order #${data.orderId} executed at $${data.executionPrice?.toFixed(2)} `
                };
            case 'OrderPartiallyFilled':
                return {
                    id: `order - partial - ${data.orderId} -${timestamp} `,
                    type: 'ORDER_PARTIALLY_FILLED',
                    orderId: data.orderId,
                    filledSize: data.filledSize,
                    timestamp,
                    message: `Order #${data.orderId} partially filled: ${data.filledSize} USDC`
                };
            case 'OrderCancelled':
                return {
                    id: `order - cancelled - ${data.orderId} -${timestamp} `,
                    type: 'ORDER_CANCELLED',
                    orderId: data.orderId,
                    timestamp,
                    message: `Order #${data.orderId} cancelled`
                };
            case 'OrderExpired':
                return {
                    id: `order - expired - ${data.orderId} -${timestamp} `,
                    type: 'ORDER_EXPIRED',
                    orderId: data.orderId,
                    timestamp,
                    message: `Order #${data.orderId} expired`
                };
            case 'PositionOpened':
                return {
                    id: `position - opened - ${data.positionId} -${timestamp} `,
                    type: 'POSITION_OPENED',
                    positionId: data.positionId,
                    collectionId: data.collectionId,
                    size: data.size,
                    executionPrice: data.entryPrice,
                    timestamp,
                    message: `Position opened: ${data.isLong ? 'LONG' : 'SHORT'} ${data.collectionId} `
                };
            case 'PositionClosed':
                return {
                    id: `position - closed - ${data.positionId} -${timestamp} `,
                    type: 'POSITION_CLOSED',
                    positionId: data.positionId,
                    pnl: data.pnl,
                    timestamp,
                    message: `Position closed: ${data.pnl >= 0 ? '+' : ''}$${data.pnl?.toFixed(2)} PnL`
                };
            case 'PositionLiquidated':
                return {
                    id: `position - liquidated - ${data.positionId} -${timestamp} `,
                    type: 'POSITION_LIQUIDATED',
                    positionId: data.positionId,
                    timestamp,
                    message: `Position #${data.positionId} was liquidated!`
                };
            default:
                return null;
        }
    };

    const shouldShowNotification = (notification: OrderNotification, settings: NotificationSettings): boolean => {
        switch (notification.type) {
            case 'ORDER_EXECUTED': return settings.orderExecuted;
            case 'ORDER_PARTIALLY_FILLED': return settings.orderPartiallyFilled;
            case 'ORDER_CANCELLED': return settings.orderCancelled;
            case 'ORDER_EXPIRED': return settings.orderExpired;
            case 'POSITION_OPENED': return settings.positionOpened;
            case 'POSITION_CLOSED': return settings.positionClosed;
            case 'POSITION_LIQUIDATED': return settings.positionLiquidated;
            default: return true;
        }
    };

    const showNotification = (notification: OrderNotification) => {
        const getToastIcon = () => {
            switch (notification.type) {
                case 'ORDER_EXECUTED': return '✅';
                case 'ORDER_PARTIALLY_FILLED': return '📊';
                case 'ORDER_CANCELLED': return '❌';
                case 'ORDER_EXPIRED': return '⏰';
                case 'POSITION_OPENED': return '📈';
                case 'POSITION_CLOSED': return notification.pnl && notification.pnl >= 0 ? '💰' : '📉';
                case 'POSITION_LIQUIDATED': return '🔥';
                default: return '📢';
            }
        };

        const getToastStyle = (): CSSProperties => {
            if (notification.type === 'POSITION_LIQUIDATED') {
                return { background: 'var(--short)', color: '#fff' };
            }
            if (notification.type === 'POSITION_CLOSED' && notification.pnl != null) {
                return notification.pnl >= 0
                    ? { background: 'var(--long)', color: '#fff' }
                    : { background: 'var(--short)', color: '#fff' };
            }
            return {};
        };

        toast(`${getToastIcon()} ${notification.message} `, {
            duration: 5000,
            style: getToastStyle(),
            position: 'bottom-right',
        });

        if (settings.soundEnabled) {
            playNotificationSound(notification.type);
        }
    };

    const playNotificationSound = (type: OrderNotification['type']) => {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = type === 'POSITION_LIQUIDATED' ? 200 : 440;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        } catch {
            /* audio not supported or failed */
        }
    };

    const updateSettings = (newSettings: Partial<NotificationSettings>) => {
        setSettings((prev: any) => ({ ...prev, ...newSettings }));
    };

    const clearNotifications = () => {
        setNotifications([]);
    };

    const markAsRead = (id: string) => {
        setNotifications((prev: any) => prev.filter((n: any) => n.id !== id));
    };

    return {
        connected,
        notifications,
        settings,
        updateSettings,
        clearNotifications,
        markAsRead,
        unreadCount: notifications.length
    };
}

interface NotificationBellProps {
    className?: string;
}

export function NotificationBell({ className = '' }: NotificationBellProps) {
    const { unreadCount, notifications, clearNotifications, markAsRead } = useOrderNotifications();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className={`relative ${className} `}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                aria-label={isOpen ? 'Close notifications' : 'Open notifications'}
                aria-expanded={isOpen}
            >
                <svg
                    className="w-6 h-6 text-text-muted hover:text-text-primary transition-colors"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto custom-scrollbar bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-50">
                    <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
                        <h3 className="font-semibold text-text-primary">Notifications</h3>
                        {notifications.length > 0 && (
                            <button
                                type="button"
                                onClick={clearNotifications}
                                className="text-xs text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 rounded-md px-1"
                            >
                                Clear all
                            </button>
                        )}
                    </div>

                    {notifications.length === 0 ? (
                        <div className="p-6 text-center text-text-muted text-sm">
                            No notifications yet
                        </div>
                    ) : (
                        <div className="divide-y divide-[var(--border-color)]">
                            {notifications.map((notification: any) => (
                                <div
                                    key={notification.id}
                                    className="p-3 hover:bg-[var(--bg-tertiary)]/50 cursor-pointer transition-colors"
                                    onClick={() => markAsRead(notification.id)}
                                >
                                    <p className="text-sm text-text-primary">{notification.message}</p>
                                    <p className="text-xs text-text-muted mt-1">
                                        {new Date(notification.timestamp).toLocaleTimeString()}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default NotificationBell;
