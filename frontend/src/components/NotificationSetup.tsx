import { useEffect, useState } from 'react';
import { Bell, BellRing, Download, Check, Smartphone } from 'lucide-react';
import clsx from 'clsx';
import {
    notificationPermission,
    requestNotificationPermission,
    subscribeToPush,
    notify,
    isStandalone,
    notificationsSupported,
} from '../utils/pwa';

/**
 * Off-app alerts + install entry point.
 *
 * Lets a trader (1) enable browser/push notifications for liquidation warnings
 * and TP/SL fills, and (2) install Realyx as a PWA. The install button uses the
 * captured `beforeinstallprompt` event when available, and falls back to
 * platform guidance (e.g. iOS "Add to Home Screen") otherwise.
 */
export function NotificationSetup() {
    const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
    const [busy, setBusy] = useState(false);
    const [installEvent, setInstallEvent] = useState<any>(null);
    const [installed, setInstalled] = useState(false);

    useEffect(() => {
        setPerm(notificationPermission());
        setInstalled(isStandalone());

        const onBeforeInstall = (e: Event) => {
            e.preventDefault();
            setInstallEvent(e);
        };
        const onInstalled = () => {
            setInstalled(true);
            setInstallEvent(null);
        };
        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    const enableAlerts = async () => {
        setBusy(true);
        try {
            const result = await requestNotificationPermission();
            setPerm(result);
            if (result === 'granted') {
                await subscribeToPush(); // best-effort; no-op without VAPID key
                await notify({
                    title: '🔔 Realyx alerts on',
                    body: "You'll be notified about liquidation warnings and TP/SL fills.",
                    url: '/portfolio',
                });
            }
        } finally {
            setBusy(false);
        }
    };

    const install = async () => {
        if (installEvent) {
            installEvent.prompt();
            try {
                await installEvent.userChoice;
            } catch {
                /* ignore */
            }
            setInstallEvent(null);
        }
    };

    const supported = notificationsSupported();
    const granted = perm === 'granted';
    const denied = perm === 'denied';

    return (
        <div className="space-y-4">
            {/* Alerts */}
            <div className="glass-panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                    <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', granted ? 'bg-long/10 text-[var(--long)]' : 'bg-brand/10 text-[var(--primary)]')}>
                        {granted ? <BellRing className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-bold text-text-primary">Off-app alerts</div>
                        <p className="text-xs text-text-secondary mt-0.5 max-w-sm">
                            Get notified about liquidation warnings and take-profit / stop-loss fills even when the tab is in the background.
                        </p>
                    </div>
                </div>
                <div className="shrink-0">
                    {!supported ? (
                        <span className="text-xs text-text-muted">Not supported on this browser</span>
                    ) : granted ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--long)] px-3 py-2 rounded-lg bg-long/10 border border-long/20">
                            <Check className="w-3.5 h-3.5" /> Enabled
                        </span>
                    ) : denied ? (
                        <span className="text-xs text-amber-400">Blocked — enable in browser settings</span>
                    ) : (
                        <button onClick={enableAlerts} disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                            {busy ? 'Enabling…' : 'Enable alerts'}
                        </button>
                    )}
                </div>
            </div>

            {/* Install */}
            <div className="glass-panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                        <Smartphone className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-bold text-text-primary">Install Realyx</div>
                        <p className="text-xs text-text-secondary mt-0.5 max-w-sm">
                            Add Realyx to your home screen for a full-screen, app-like experience with faster launches.
                        </p>
                    </div>
                </div>
                <div className="shrink-0">
                    {installed ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--long)] px-3 py-2 rounded-lg bg-long/10 border border-long/20">
                            <Check className="w-3.5 h-3.5" /> Installed
                        </span>
                    ) : installEvent ? (
                        <button onClick={install} className="btn-secondary px-4 py-2 text-sm inline-flex items-center gap-2">
                            <Download className="w-4 h-4" /> Install
                        </button>
                    ) : (
                        <span className="text-xs text-text-muted max-w-[180px] block">
                            Use your browser's “Add to Home Screen” to install.
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
