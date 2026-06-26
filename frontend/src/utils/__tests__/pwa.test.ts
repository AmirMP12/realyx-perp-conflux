import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Pwa = typeof import('../pwa');

// Use isolated module state per test so the module-level `registration`
// variable never leaks between cases.
async function loadPwa(): Promise<Pwa> {
    vi.resetModules();
    return import('../pwa');
}

describe('pwa utils', () => {
    const originalNotification = (globalThis as any).Notification;
    const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        if (originalNotification === undefined) {
            delete (globalThis as any).Notification;
        } else {
            (globalThis as any).Notification = originalNotification;
        }
        if (originalSW) {
            Object.defineProperty(navigator, 'serviceWorker', originalSW);
        }
    });

    function setNotification(perm: NotificationPermission, requestResult?: NotificationPermission) {
        const NotificationMock: any = vi.fn();
        NotificationMock.permission = perm;
        NotificationMock.requestPermission = vi.fn().mockResolvedValue(requestResult ?? perm);
        (globalThis as any).Notification = NotificationMock;
        return NotificationMock;
    }

    function setServiceWorker(value: any) {
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });
    }

    describe('notificationsSupported / notificationPermission', () => {
        it('returns false/unsupported when Notification is missing', async () => {
            const pwa = await loadPwa();
            delete (globalThis as any).Notification;
            expect(pwa.notificationsSupported()).toBe(false);
            expect(pwa.notificationPermission()).toBe('unsupported');
        });

        it('returns true and the current permission when supported', async () => {
            const pwa = await loadPwa();
            setNotification('granted');
            expect(pwa.notificationsSupported()).toBe(true);
            expect(pwa.notificationPermission()).toBe('granted');
        });
    });

    describe('isStandalone', () => {
        it('detects standalone via matchMedia', async () => {
            const pwa = await loadPwa();
            (window as any).matchMedia = vi.fn().mockReturnValue({ matches: true });
            expect(pwa.isStandalone()).toBe(true);
        });

        it('detects iOS standalone via navigator.standalone', async () => {
            const pwa = await loadPwa();
            (window as any).matchMedia = vi.fn().mockReturnValue({ matches: false });
            (window.navigator as any).standalone = true;
            expect(pwa.isStandalone()).toBe(true);
            (window.navigator as any).standalone = false;
            expect(pwa.isStandalone()).toBe(false);
        });
    });

    describe('requestNotificationPermission', () => {
        it('returns unsupported without Notification', async () => {
            const pwa = await loadPwa();
            delete (globalThis as any).Notification;
            await expect(pwa.requestNotificationPermission()).resolves.toBe('unsupported');
        });

        it('short-circuits when already granted', async () => {
            const pwa = await loadPwa();
            const m = setNotification('granted');
            await expect(pwa.requestNotificationPermission()).resolves.toBe('granted');
            expect(m.requestPermission).not.toHaveBeenCalled();
        });

        it('short-circuits when already denied', async () => {
            const pwa = await loadPwa();
            const m = setNotification('denied');
            await expect(pwa.requestNotificationPermission()).resolves.toBe('denied');
            expect(m.requestPermission).not.toHaveBeenCalled();
        });

        it('requests permission when default', async () => {
            const pwa = await loadPwa();
            const m = setNotification('default', 'granted');
            await expect(pwa.requestNotificationPermission()).resolves.toBe('granted');
            expect(m.requestPermission).toHaveBeenCalled();
        });

        it('falls back to current permission when request throws', async () => {
            const pwa = await loadPwa();
            const m = setNotification('default');
            m.requestPermission = vi.fn().mockRejectedValue(new Error('boom'));
            await expect(pwa.requestNotificationPermission()).resolves.toBe('default');
        });
    });

    describe('registerServiceWorker', () => {
        it('no-ops without serviceWorker support', async () => {
            const pwa = await loadPwa();
            setServiceWorker(undefined);
            expect(() => pwa.registerServiceWorker()).not.toThrow();
        });

        it('registers on window load', async () => {
            const pwa = await loadPwa();
            const register = vi.fn().mockResolvedValue({ scope: '/' });
            setServiceWorker({ register, ready: Promise.resolve({}) });
            pwa.registerServiceWorker();
            window.dispatchEvent(new Event('load'));
            await Promise.resolve();
            expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
        });

        it('logs a warning when registration fails', async () => {
            const pwa = await loadPwa();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const register = vi.fn().mockRejectedValue(new Error('nope'));
            setServiceWorker({ register });
            pwa.registerServiceWorker();
            window.dispatchEvent(new Event('load'));
            await Promise.resolve();
            await Promise.resolve();
            expect(register).toHaveBeenCalled();
            warn.mockRestore();
        });
    });

    describe('subscribeToPush', () => {
        const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';

        afterEach(() => {
            vi.unstubAllEnvs();
            delete (globalThis as any).PushManager;
            delete (window as any).PushManager;
        });

        it('returns null when push/VAPID unavailable', async () => {
            const pwa = await loadPwa();
            setServiceWorker({ ready: Promise.resolve({}) });
            await expect(pwa.subscribeToPush()).resolves.toBeNull();
        });

        async function loadWithVapid(): Promise<Pwa> {
            vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VAPID);
            (globalThis as any).PushManager = function () {};
            (window as any).PushManager = (globalThis as any).PushManager;
            return loadPwa();
        }

        it('returns an existing subscription when present', async () => {
            const existing = { endpoint: 'x' };
            const pushManager = {
                getSubscription: vi.fn().mockResolvedValue(existing),
                subscribe: vi.fn(),
            };
            const pwa = await loadWithVapid();
            setServiceWorker({ ready: Promise.resolve({ pushManager }) });
            await expect(pwa.subscribeToPush()).resolves.toBe(existing);
            expect(pushManager.subscribe).not.toHaveBeenCalled();
        });

        it('subscribes via pushManager when none exists', async () => {
            const created = { endpoint: 'new' };
            const pushManager = {
                getSubscription: vi.fn().mockResolvedValue(null),
                subscribe: vi.fn().mockResolvedValue(created),
            };
            const pwa = await loadWithVapid();
            setServiceWorker({ ready: Promise.resolve({ pushManager }) });
            await expect(pwa.subscribeToPush()).resolves.toBe(created);
            expect(pushManager.subscribe).toHaveBeenCalledWith(
                expect.objectContaining({ userVisibleOnly: true }),
            );
        });

        it('returns null and warns when subscribe throws', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const pushManager = {
                getSubscription: vi.fn().mockRejectedValue(new Error('denied')),
            };
            const pwa = await loadWithVapid();
            setServiceWorker({ ready: Promise.resolve({ pushManager }) });
            await expect(pwa.subscribeToPush()).resolves.toBeNull();
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });
    });

    describe('notify', () => {
        it('no-ops when permission not granted', async () => {
            const pwa = await loadPwa();
            setNotification('default');
            await expect(pwa.notify({ title: 't', body: 'b' })).resolves.toBeUndefined();
        });

        it('uses service worker showNotification when available', async () => {
            const pwa = await loadPwa();
            setNotification('granted');
            const showNotification = vi.fn().mockResolvedValue(undefined);
            setServiceWorker({ ready: Promise.resolve({ showNotification }) });
            await pwa.notify({ title: 'Hi', body: 'there', url: '/x', urgent: true, tag: 'z' });
            expect(showNotification).toHaveBeenCalledWith('Hi', expect.objectContaining({ body: 'there', requireInteraction: true, tag: 'z' }));
        });

        it('falls back to plain Notification when SW ready rejects', async () => {
            const pwa = await loadPwa();
            const m = setNotification('granted');
            setServiceWorker({ ready: Promise.reject(new Error('no sw')) });
            await pwa.notify({ title: 'Plain', body: 'note' });
            expect(m).toHaveBeenCalledWith('Plain', expect.objectContaining({ body: 'note' }));
        });
    });
});
