/**
 * PWA registration + push-notification helpers.
 *
 * Registers the service worker (offline shell + push handling) and exposes a
 * minimal API for enabling local/push notifications for liquidation warnings
 * and TP/SL fills — the off-app alerts perp traders need. Push subscription is
 * best-effort and only attempted when a VAPID key is configured; without one we
 * still deliver in-app + Notification API alerts via `notify()`.
 */

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();

let registration: ServiceWorkerRegistration | null = null;

export function registerServiceWorker(): void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Register after load so it never competes with first paint.
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js', { scope: '/' })
            .then((reg) => {
                registration = reg;
            })
            .catch((err) => {
                console.warn('[pwa] service worker registration failed:', err);
            });
    });
}

export function isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        window.matchMedia?.('(display-mode: standalone)').matches ||
        // iOS Safari
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
}

export function notificationsSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
    if (!notificationsSupported()) return 'unsupported';
    return Notification.permission;
}

/** Ask for notification permission; returns the resulting permission state. */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (!notificationsSupported()) return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
        return Notification.permission;
    }
    try {
        return await Notification.requestPermission();
    } catch {
        return Notification.permission;
    }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

/**
 * Best-effort push subscription. Returns the subscription (to POST to a backend
 * push service) or null when push isn't available/configured. When no VAPID key
 * is set we skip silently — local Notification alerts via `notify()` still work.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return null;
    try {
        const reg = registration ?? (await navigator.serviceWorker.ready);
        const existing = await reg.pushManager.getSubscription();
        if (existing) return existing;
        return await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        });
    } catch (err) {
        console.warn('[pwa] push subscribe failed:', err);
        return null;
    }
}

export interface RealyxNotification {
    title: string;
    body: string;
    url?: string;
    urgent?: boolean;
    tag?: string;
}

/**
 * Deliver a notification off-app. Prefers the service worker registration (so
 * it works when the tab is backgrounded / app installed) and falls back to a
 * plain Notification. No-op when permission isn't granted.
 */
export async function notify(n: RealyxNotification): Promise<void> {
    if (!notificationsSupported() || Notification.permission !== 'granted') return;
    const options: NotificationOptions = {
        body: n.body,
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: n.tag ?? 'realyx-alert',
        data: { url: n.url ?? '/portfolio' },
        requireInteraction: n.urgent === true,
    };
    try {
        const reg = registration ?? (await navigator.serviceWorker?.ready);
        if (reg) {
            await reg.showNotification(n.title, options);
            return;
        }
    } catch {
        /* fall through to plain Notification */
    }
    try {
        new Notification(n.title, options);
    } catch {
        /* ignore */
    }
}
