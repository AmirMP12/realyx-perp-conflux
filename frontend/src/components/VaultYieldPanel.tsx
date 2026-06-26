import { useMemo } from 'react';
import clsx from 'clsx';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Percent, Info, TrendingUp } from 'lucide-react';
import { useVaultYield, type VaultYieldSource } from '../hooks/useVaultYield';
import { Skeleton } from './ui';

const SOURCE_COLOR: Record<VaultYieldSource['key'], string> = {
    borrowFees: 'var(--primary)',
    funding: '#8b5cf6',
    liquidations: 'var(--long)',
};

/**
 * LP real-yield dashboard: a single headline APR, a breakdown by revenue source
 * (borrow/trading fees, funding, liquidations) with proportion bars, and a 30d
 * APR history curve. This is the TVL growth engine — it proves the vault yield
 * is real, trader-driven, and sustainable rather than inflationary emissions.
 */
export function VaultYieldPanel() {
    const { yield: y, loading } = useVaultYield();

    const maxApr = useMemo(() => Math.max(0.0001, ...y.sources.map((s) => Math.abs(s.apr))), [y.sources]);
    const hasHistory = y.history.length > 1;

    return (
        <div className="glass-panel overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                        <Percent className="w-4 h-4 text-[var(--primary)]" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-text-primary uppercase tracking-wide">Real Yield (LP APR)</h3>
                        <p className="text-[11px] text-text-muted">Trailing {y.windowDays}d · from trader activity</p>
                    </div>
                </div>
                <div className="text-right">
                    {loading ? (
                        <Skeleton className="h-8 w-20" />
                    ) : (
                        <div className="text-2xl font-bold font-mono tabular-nums text-[var(--long)] leading-none">
                            {y.totalApr.toFixed(1)}%
                        </div>
                    )}
                    <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">Est. APR</div>
                </div>
            </div>

            <div className="p-5 space-y-5">
                {/* Source breakdown */}
                <div className="space-y-3">
                    {loading && y.sources.length === 0 ? (
                        [1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)
                    ) : y.sources.length === 0 ? (
                        <div className="text-center py-6 text-sm text-text-muted">
                            No yield data yet. As traders open positions, fees accrue to LPs and the breakdown populates here.
                        </div>
                    ) : (
                        y.sources.map((s) => (
                            <div key={s.key}>
                                <div className="flex items-center justify-between text-xs mb-1.5">
                                    <span className="flex items-center gap-2 text-text-secondary">
                                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: SOURCE_COLOR[s.key] }} />
                                        {s.label}
                                    </span>
                                    <span className="font-mono tabular-nums text-text-primary">
                                        {s.apr.toFixed(2)}% <span className="text-text-muted">· ${s.amountUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                    </span>
                                </div>
                                <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ width: `${Math.min(100, (Math.abs(s.apr) / maxApr) * 100)}%`, backgroundColor: SOURCE_COLOR[s.key] }}
                                    />
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* History curve */}
                {hasHistory && (
                    <div>
                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted font-semibold uppercase tracking-wider mb-2">
                            <TrendingUp className="w-3.5 h-3.5" />
                            APR history
                        </div>
                        <div className="h-[140px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={y.history} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="vaultAprGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="var(--long)" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="var(--long)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.4} />
                                    <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={24} />
                                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={38} />
                                    <Tooltip
                                        contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                                        labelStyle={{ color: 'var(--text-primary)' }}
                                        formatter={(value: number, name: string) => [name === 'apr' ? `${value.toFixed(2)}%` : `$${value.toFixed(2)}`, name === 'apr' ? 'APR' : 'Fees']}
                                    />
                                    <Area type="monotone" dataKey="apr" stroke="var(--long)" fill="url(#vaultAprGradient)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* Estimate disclaimer */}
                <div className={clsx('flex items-start gap-2 rounded-lg px-3 py-2.5 bg-surface-3/50 border border-line/50')}>
                    <Info className="w-3.5 h-3.5 text-text-muted shrink-0 mt-px" />
                    <p className="text-[10px] text-text-muted leading-snug">
                        Estimated from indexed trading activity over the trailing {y.windowDays} days, normalized to current TVL. Realized LP returns are reflected directly in the LP share price.
                    </p>
                </div>
            </div>
        </div>
    );
}
