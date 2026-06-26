import { Link } from 'react-router-dom';
import { Copy, TrendingUp, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useTopTraders } from '../../hooks/useSocial';
import { formatCompact, truncateAddress } from '../../utils/format';

/**
 * Discoverable copy-trading entry point on the trade page. Surfaces the top lead
 * traders inline so copy-trading isn't buried behind its own nav route — a
 * funnel improvement for one of the venue's strongest growth primitives.
 * Renders nothing when the feature is unprovisioned or no traders exist.
 */
export function CopyTradersStrip({ className }: { className?: string }) {
    const { traders, loading } = useTopTraders();

    if (loading || traders.length === 0) return null;

    const top = traders.slice(0, 4);

    return (
        <div className={clsx('glass-panel rounded-2xl p-3.5 sm:p-4 border border-line/60', className)}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Copy className="w-4 h-4 text-[var(--primary)]" />
                    <span className="text-sm font-bold text-text-primary">Copy top traders</span>
                    <span className="hidden sm:inline text-[11px] text-text-muted">Mirror proven strategies automatically</span>
                </div>
                <Link
                    to="/copy-trading"
                    className="flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline"
                >
                    View all
                    <ChevronRight className="w-3.5 h-3.5" />
                </Link>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {top.map((t) => {
                    const roiPositive = t.roi >= 0;
                    return (
                        <Link
                            key={t.address}
                            to={`/trader/${t.address}`}
                            className="group rounded-xl border border-line/60 bg-surface-3/40 hover:bg-surface-3/70 hover:border-brand/40 transition-all p-3 min-w-0"
                        >
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-xs font-mono font-semibold text-text-primary truncate">
                                    {truncateAddress(t.address)}
                                </span>
                                <TrendingUp className={clsx('w-3.5 h-3.5 shrink-0', roiPositive ? 'text-[var(--long)]' : 'text-[var(--short)]')} />
                            </div>
                            <div className={clsx('text-base font-bold font-mono tabular-nums leading-none', roiPositive ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                                {roiPositive ? '+' : ''}{t.roi.toFixed(1)}%
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-text-muted mt-1.5 tabular-nums">
                                <span>{t.activeFollowers} copiers</span>
                                <span>{formatCompact(parseFloat(t.totalPnl || '0'))} PnL</span>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
