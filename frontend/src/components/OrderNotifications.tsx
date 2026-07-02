import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';
import { formatPriceWithPrecision } from '../utils/format';
import { usePositions } from '../hooks/usePositions';
import { notify } from '../utils/pwa';

const WS_URL = (import.meta.env.VITE_WS_URL ?? "").trim() || (import.meta.env.DEV ? "ws://localhost:3002" : "");

const LIQUIDATION_WARNING_THRESHOLD = 1.1;
const HEALTH_CHECK_INTERVAL_MS = 8000;
const LIQUIDATION_WARN_DEBOUNCE_MS = 60000;

export interface OrderNotification {
    id: string;
    type: 'ORDER_EXECUTED' | 'ORDER_PARTIALLY_FILLED' | 'ORDER_CANCELLED' | 'ORDER_EXPIRED' | 'POSITION_OPENED' | 'POSITION_CLOSED' | 'POSITION_LIQUIDATED' | 'LIQUIDATION_WARNING' | 'FUNDING_PAYMENT' | 'KEEPER_FAILURE';
    orderId?: number;
    positionId?: number;
    collectionId?: string;
    size?: number;
    filledSize?: number;
    executionPrice?: number;
    pnl?: number;
    failureReason?: string;
    timestamp: number;
    message: string;
}

export interface NotificationSettings {
    orderExecuted: boolean;
    orderPartiallyFilled: boolean;
    orderCancelled: boolean;
    orderExpired: boolean;
    positionOpened: boolean;
    positionClosed: boolean;
    positionLiquidated: boolean;
    liquidationWarning: boolean;
    fundingPayment: boolean;
    keeperFailure: boolean;
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
    liquidationWarning: true,
    fundingPayment: true,
    keeperFailure: true,
    soundEnabled: false
};

export interface OrderNotificationsOptions {
    /** Called whenever an order is executed or a position is opened/closed/liquidated. Use to trigger an immediate data refetch. */
    onOrderExecuted?: () => void;
}

export function useOrderNotifications(options: OrderNotificationsOptions = {}) {
    const { address } = useAccount();
    const { positions } = usePositions();
    const onOrderExecutedRef = useRef(options.onOrderExecuted);
    // Keep the ref in sync so the callback in handleWebSocketMessage is always current.
    useEffect(() => {
        onOrderExecutedRef.current = options.onOrderExecuted;
    }, [options.onOrderExecuted]);
    const [connected, setConnected] = useState(false);
    const [notifications, setNotifications] = useState<OrderNotification[]>([]);
    const [settings, setSettings] = useState<NotificationSettings>(() => {
        const saved = localStorage.getItem('notificationSettings');
        return saved ? JSON.parse(saved) : defaultSettings;
    });
    const [ws, setWs] = useState<WebSocket | null>(null);
    const lastWarnedRef = useRef<Map<string, number>>(new Map());
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    useEffect(() => {
        localStorage.setItem('notificationSettings', JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        if (!address || !WS_URL) return;

        const websocket = new WebSocket(WS_URL);

        websocket.onopen = () => {
            setConnected(true);
            // Register for user-targeted broadcasts (e.g. KEEPER_FAILURE). The
            // backend wsServer expects `{ type: 'subscribe:user', address }`.
            websocket.send(JSON.stringify({
                type: 'subscribe:user',
                address: address.toLowerCase(),
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

    // --- Local Health Factor Monitoring ---
    useEffect(() => {
        if (!positions || positions.length === 0) return;

        const checkHealth = () => {
            for (const pos of positions) {
                const markPrice = parseFloat(pos.markPrice);
                const liqPrice = parseFloat(pos.liquidationPrice);
                const posId = pos.id;

                if (markPrice <= 0 || liqPrice <= 0) continue;

                let healthFactor: number;
                if (pos.isLong) {
                    healthFactor = markPrice / liqPrice;
                } else {
                    healthFactor = liqPrice / markPrice;
                }

                if (healthFactor < LIQUIDATION_WARNING_THRESHOLD && healthFactor > 1.0) {
                    const lastWarned = lastWarnedRef.current.get(posId) || 0;
                    const now = Date.now();
                    if (now - lastWarned < LIQUIDATION_WARN_DEBOUNCE_MS) continue;

                    lastWarnedRef.current.set(posId, now);

                    const notification: OrderNotification = {
                        id: `liq-warn-${posId}-${now}`,
                        type: 'LIQUIDATION_WARNING',
                        positionId: parseInt(posId),
                        timestamp: now,
                        message: `⚠️ Position #${posId} (${pos.isLong ? 'LONG' : 'SHORT'}) nearing liquidation! Health: ${healthFactor.toFixed(2)}x`
                    };

                    if (settingsRef.current.liquidationWarning) {
                        // Add to notification bell only — no toast popup for liquidation warnings
                        setNotifications((prev) => [notification, ...prev].slice(0, 50));
                    }
                }
            }
        };

        checkHealth();
        const interval = setInterval(checkHealth, HEALTH_CHECK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [positions]);

    const handleWebSocketMessage = useCallback((data: any) => {
        if (data.type === 'notification') {
            const notification = parseNotification(data.data);
            if (notification && shouldShowNotification(notification, settingsRef.current)) {
                showNotification(notification, settingsRef.current);
                setNotifications((prev: any) => [notification, ...prev].slice(0, 50));
            }
            // Trigger a data refetch whenever an order or position changes state so the
            // positions panel and pending-orders list update immediately without waiting
            // for the next polling interval.
            const refetchEvents = ['OrderExecuted', 'OrderCancelled', 'OrderExpired', 'PositionOpened', 'PositionClosed', 'PositionLiquidated'];
            if (refetchEvents.includes(data.data?.event)) {
                onOrderExecutedRef.current?.();
            }
            return;
        }

        // Direct user-targeted broadcasts from the backend (broadcastToUser):
        // `{ type, data, traderAddress }`. Currently the server emits KEEPER_FAILURE.
        const direct = parseDirectUserMessage(data);
        if (direct && shouldShowNotification(direct, settingsRef.current)) {
            showNotification(direct, settingsRef.current);
            setNotifications((prev: any) => [direct, ...prev].slice(0, 50));
        }
    }, []);

    const parseDirectUserMessage = (msg: any): OrderNotification | null => {
        const timestamp = Date.now();
        const data = msg?.data ?? {};
        switch (msg?.type) {
            case 'KEEPER_FAILURE':
                return {
                    id: `keeper-fail-${data.orderId}-${timestamp}`,
                    type: 'KEEPER_FAILURE',
                    orderId: data.orderId,
                    failureReason: data.failureReason,
                    timestamp,
                    message: `❌ Order #${data.orderId} execution failed: ${data.failureReason || 'Unknown error'}`,
                };
            default:
                return null;
        }
    };

    const parseNotification = (data: any): OrderNotification | null => {
        const timestamp = Date.now();

        switch (data.event) {
            case 'OrderExecuted':
                return {
                    id: `order-${data.orderId}-${timestamp}`,
                    type: 'ORDER_EXECUTED',
                    orderId: data.orderId,
                    collectionId: data.collectionId,
                    filledSize: data.filledSize,
                    executionPrice: data.executionPrice,
                    timestamp,
                    message: `Order #${data.orderId} executed at $${formatPriceWithPrecision(data.executionPrice || 0)}`
                };
            case 'OrderPartiallyFilled':
                return {
                    id: `order-partial-${data.orderId}-${timestamp}`,
                    type: 'ORDER_PARTIALLY_FILLED',
                    orderId: data.orderId,
                    filledSize: data.filledSize,
                    timestamp,
                    message: `Order #${data.orderId} partially filled: ${data.filledSize} USDT0`
                };
            case 'OrderCancelled':
                return {
                    id: `order-cancelled-${data.orderId}-${timestamp}`,
                    type: 'ORDER_CANCELLED',
                    orderId: data.orderId,
                    timestamp,
                    message: `Order #${data.orderId} cancelled`
                };
            case 'OrderExpired':
                return {
                    id: `order-expired-${data.orderId}-${timestamp}`,
                    type: 'ORDER_EXPIRED',
                    orderId: data.orderId,
                    timestamp,
                    message: `Order #${data.orderId} expired`
                };
            case 'PositionOpened':
                return {
                    id: `position-opened-${data.positionId}-${timestamp}`,
                    type: 'POSITION_OPENED',
                    positionId: data.positionId,
                    collectionId: data.collectionId,
                    size: data.size,
                    executionPrice: data.entryPrice,
                    timestamp,
                    message: `Position opened: ${data.isLong ? 'LONG' : 'SHORT'} ${data.collectionId}`
                };
            case 'PositionClosed':
                return {
                    id: `position-closed-${data.positionId}-${timestamp}`,
                    type: 'POSITION_CLOSED',
                    positionId: data.positionId,
                    pnl: data.pnl,
                    timestamp,
                    message: `Position closed: ${data.pnl >= 0 ? '+' : ''}$${data.pnl?.toFixed(2)} PnL`
                };
            case 'PositionLiquidated':
                return {
                    id: `position-liquidated-${data.positionId}-${timestamp}`,
                    type: 'POSITION_LIQUIDATED',
                    positionId: data.positionId,
                    timestamp,
                    message: `Position #${data.positionId} was liquidated!`
                };
            case 'LiquidationWarning':
                return {
                    id: `liq-warn-svr-${data.positionId}-${timestamp}`,
                    type: 'LIQUIDATION_WARNING',
                    positionId: data.positionId,
                    timestamp,
                    message: `⚠️ Position #${data.positionId} nearing liquidation threshold!`
                };
            case 'FundingPayment':
                return {
                    id: `funding-${data.positionId}-${timestamp}`,
                    type: 'FUNDING_PAYMENT',
                    positionId: data.positionId,
                    pnl: data.amount,
                    timestamp,
                    message: `Funding payment: ${data.amount >= 0 ? '+' : ''}$${data.amount?.toFixed(4)} for position #${data.positionId}`
                };
            case 'KeeperFailure':
                return {
                    id: `keeper-fail-${data.orderId}-${timestamp}`,
                    type: 'KEEPER_FAILURE',
                    orderId: data.orderId,
                    failureReason: data.failureReason,
                    timestamp,
                    message: `❌ Order #${data.orderId} execution failed: ${data.failureReason || 'Unknown error'}`
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
            case 'LIQUIDATION_WARNING': return settings.liquidationWarning;
            case 'FUNDING_PAYMENT': return settings.fundingPayment;
            case 'KEEPER_FAILURE': return settings.keeperFailure;
            default: return true;
        }
    };

    const showNotification = (notification: OrderNotification, currentSettings: NotificationSettings) => {
        // Liquidation warnings go silently to the bell only — no disruptive toast popup
        if (notification.type === 'LIQUIDATION_WARNING') return;
        const getToastIcon = () => {
            switch (notification.type) {
                case 'ORDER_EXECUTED': return '✅';
                case 'ORDER_PARTIALLY_FILLED': return '📊';
                case 'ORDER_CANCELLED': return '❌';
                case 'ORDER_EXPIRED': return '⏰';
                case 'POSITION_OPENED': return '📈';
                case 'POSITION_CLOSED': return notification.pnl && notification.pnl >= 0 ? '💰' : '📉';
                case 'POSITION_LIQUIDATED': return '🔥';
                case 'LIQUIDATION_WARNING': return '⚠️';
                case 'FUNDING_PAYMENT': return '💸';
                case 'KEEPER_FAILURE': return '🛑';
                default: return '📢';
            }
        };

        const getToastStyle = (): CSSProperties => {
            if (notification.type === 'POSITION_LIQUIDATED') {
                return { background: 'var(--short)', color: '#fff' };
            }
            if (notification.type === 'LIQUIDATION_WARNING') {
                return { background: 'var(--notification-warning-bg)', border: '1px solid var(--notification-warning)', color: 'var(--text-primary)' };
            }
            if (notification.type === 'KEEPER_FAILURE') {
                return { background: 'var(--notification-failure-bg)', border: '1px solid var(--notification-failure)', color: 'var(--text-primary)' };
            }
            if (notification.type === 'FUNDING_PAYMENT') {
                return { background: 'var(--notification-funding-bg)', border: '1px solid var(--notification-funding)', color: 'var(--text-primary)' };
            }
            if (notification.type === 'POSITION_CLOSED' && notification.pnl != null) {
                return notification.pnl >= 0
                    ? { background: 'var(--long)', color: '#fff' }
                    : { background: 'var(--short)', color: '#fff' };
            }
            return {};
        };

        const isHighPriority = notification.type === 'LIQUIDATION_WARNING' || notification.type === 'POSITION_LIQUIDATED' || notification.type === 'KEEPER_FAILURE';

        toast(`${getToastIcon()} ${notification.message}`, {
            duration: isHighPriority ? 8000 : 5000,
            style: getToastStyle(),
            position: 'bottom-right',
            className: `toast-notification ${notification.type.toLowerCase()}`,
        });

        // Off-app push/system notification for the alerts traders need while the
        // tab is backgrounded or the PWA is installed (liquidation warnings,
        // liquidations, keeper failures, and TP/SL fills). No-op unless the user
        // has granted notification permission.
        const pushTypes: OrderNotification['type'][] = [
            'LIQUIDATION_WARNING',
            'POSITION_LIQUIDATED',
            'KEEPER_FAILURE',
            'ORDER_EXECUTED',
            'POSITION_CLOSED',
        ];
        if (pushTypes.includes(notification.type)) {
            void notify({
                title: `${getToastIcon()} Realyx`,
                body: notification.message,
                url: '/portfolio',
                urgent: isHighPriority,
                tag: notification.type.toLowerCase(),
            });
        }

        if (currentSettings.soundEnabled) {
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

            if (type === 'POSITION_LIQUIDATED' || type === 'KEEPER_FAILURE') {
                oscillator.frequency.value = 200;
            } else if (type === 'LIQUIDATION_WARNING') {
                oscillator.frequency.value = 330;
            } else {
                oscillator.frequency.value = 440;
            }
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        } catch {
            /* audio not supported or failed */
        }
    };

    const updateSettings = (newSettings: Partial<NotificationSettings>) => {
        setSettings((prev) => ({ ...prev, ...newSettings }));
    };

    const clearNotifications = () => {
        setNotifications([]);
    };

    const markAsRead = (id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
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

    const getNotificationColor = (type: string): string => {
        switch (type) {
            case 'LIQUIDATION_WARNING': return 'border-l-[var(--notification-warning)]';
            case 'KEEPER_FAILURE': return 'border-l-[var(--notification-failure)]';
            case 'POSITION_LIQUIDATED': return 'border-l-[var(--short)]';
            case 'FUNDING_PAYMENT': return 'border-l-[var(--notification-funding)]';
            case 'ORDER_EXECUTED':
            case 'POSITION_OPENED': return 'border-l-[var(--long)]';
            default: return '';
        }
    };

    return (
        <div className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
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
                                className="text-xs text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-md px-1"
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
                            {notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className={`p-3 hover:bg-surface-3/50 cursor-pointer transition-colors border-l-2 ${getNotificationColor(notification.type)}`}
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
