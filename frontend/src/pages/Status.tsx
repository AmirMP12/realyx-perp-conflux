import clsx from 'clsx';
import { Activity, CheckCircle2, AlertTriangle, XCircle, ShieldCheck, RefreshCw } from 'lucide-react';
import { useSystemStatus, type Health, type StatusComponent } from '../hooks/useSystemStatus';
import { formatCompact } from '../utils/format';
import { Skeleton } from '../components/ui';

const HEALTH_META: Record<Health, { label: string; tone: string; bg: string; Icon: typeof CheckCircle2 }> = {
    operational: { label: 'Operational', tone: 'text-[var(--long)]', bg: 'bg-long/10 border-long/25', Icon: CheckCircle2 },
    degraded: { label: 'Degraded', tone: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/25', Icon: AlertTriangle },
    down: { label: 'Down', tone: 'text-[var(--short)]', bg: 'bg-short/10 border-short/25', Icon: XCircle },
};

function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export function StatusPage() {
    const { status, loading, refetch, updatedAt } = useSystemStatus();

    const overall = status?.status ?? 'operational';
    const meta = HEALTH_META[overall];

    return (
        <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-text-primary mb-2 flex items-center gap-3">
                        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-indigo-500 flex items-center justify-center shadow-lg shadow-brand/20">
                            <Activity className="w-5 h-5 lg:w-6 lg:h-6 text-white" />
                        </div>
                        System Status
                    </h1>
                    <p className="text-text-secondary">Live health of the oracle, RPC, indexer, and vault solvency.</p>
                </div>
                <button
                    onClick={() => refetch()}
                    className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm self-start"
                >
                    <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
                    Refresh
                </button>
            </div>

            {/* Overall banner */}
            <div className={clsx('glass-panel p-5 sm:p-6 flex items-center justify-between gap-4 border', meta.bg)}>
                <div className="flex items-center gap-3">
                    <meta.Icon className={clsx('w-8 h-8', meta.tone)} />
                    <div>
                        <div className={clsx('text-lg sm:text-xl font-bold', meta.tone)}>
                            {loading && !status ? 'Checking…' : `All systems ${meta.label.toLowerCase()}`}
                        </div>
                        {status && (
                            <div className="text-xs text-text-muted tabular-nums">
                                Uptime {formatUptime(status.uptimeSeconds)}
                                {updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString()}` : ''}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Components */}
            <div className="glass-panel overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--border-color)]">
                    <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide">Components</h2>
                </div>
                <div className="divide-y divide-line/50">
                    {loading && !status ? (
                        [1, 2, 3, 4].map((i) => (
                            <div key={i} className="px-5 py-4 flex items-center justify-between">
                                <Skeleton className="h-5 w-32" />
                                <Skeleton className="h-5 w-24" />
                            </div>
                        ))
                    ) : (
                        (status?.components ?? []).map((c: StatusComponent) => {
                            const cm = HEALTH_META[c.status];
                            return (
                                <div key={c.key} className="px-5 py-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <cm.Icon className={clsx('w-4 h-4 shrink-0', cm.tone)} />
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-text-primary">{c.label}</div>
                                            {c.detail && <div className="text-[11px] text-text-muted truncate">{c.detail}</div>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        {c.latencyMs != null && (
                                            <span className="text-[11px] text-text-muted tabular-nums font-mono">{c.latencyMs}ms</span>
                                        )}
                                        <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-md border', cm.bg, cm.tone)}>
                                            {cm.label}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Vault solvency / transparency */}
            <div className="glass-panel overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
                    <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide">Vault Transparency</h2>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line/50">
                    <SolvencyStat label="Total Value Locked" value={status ? formatCompact(status.vault.tvl) : '—'} loading={loading && !status} />
                    <SolvencyStat label="Insurance Fund" value={status ? formatCompact(status.vault.insuranceFund) : '—'} loading={loading && !status} />
                    <SolvencyStat
                        label="Solvency Ratio"
                        value={status ? (status.vault.solvencyRatio == null ? 'Fully backed' : `${status.vault.solvencyRatio.toFixed(2)}x`) : '—'}
                        valueColor={status && status.vault.solvencyRatio != null && status.vault.solvencyRatio < 1 ? 'text-[var(--short)]' : 'text-[var(--long)]'}
                        loading={loading && !status}
                    />
                    <SolvencyStat
                        label="Insurance Health"
                        value={status ? `${status.vault.insuranceHealthPct.toFixed(0)}%` : '—'}
                        valueColor={status && status.vault.insuranceHealthy ? 'text-[var(--long)]' : 'text-amber-400'}
                        loading={loading && !status}
                    />
                </div>
            </div>

            <p className="text-center text-xs text-text-muted">
                Status reflects live on-chain and infrastructure checks. Solvency ratio = (LP assets + insurance) ÷ borrowed.
            </p>
        </div>
    );
}

function SolvencyStat({ label, value, valueColor, loading }: { label: string; value: string; valueColor?: string; loading?: boolean }) {
    return (
        <div className="p-5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-semibold mb-2">{label}</div>
            {loading ? (
                <Skeleton className="h-7 w-24" />
            ) : (
                <div className={clsx('text-lg sm:text-xl font-bold font-mono tabular-nums', valueColor || 'text-text-primary')}>{value}</div>
            )}
        </div>
    );
}

export default StatusPage;
