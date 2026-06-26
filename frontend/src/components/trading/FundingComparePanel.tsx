import clsx from 'clsx';
import { TrendingUp, TrendingDown, Minus, ShieldCheck } from 'lucide-react';
import { useReferenceFunding } from '../../hooks/useReferenceFunding';
import { compareFunding, type FundingFairness } from '../../utils/fundingCompare';

interface FundingComparePanelProps {
    /** Realyx market symbol, e.g. "BTC-USD". */
    symbol: string | undefined;
    /** Raw 8h funding rate (fraction) from the market. */
    fundingRate: number;
    /** Trader's side, for cost-perspective fairness. */
    side?: 'long' | 'short';
    className?: string;
}

const FAIRNESS_META: Record<FundingFairness, { label: string; tone: string; bg: string }> = {
    tighter: { label: 'Cheaper than Binance', tone: 'text-[var(--long)]', bg: 'bg-long/10 border-long/20' },
    inline: { label: 'In line with Binance', tone: 'text-text-secondary', bg: 'bg-surface-3/60 border-line/60' },
    wider: { label: 'Above Binance', tone: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    unknown: { label: 'No CEX reference', tone: 'text-text-muted', bg: 'bg-surface-3/60 border-line/60' },
};

function aprLabel(apr: number): string {
    const sign = apr > 0 ? '+' : '';
    return `${sign}${apr.toFixed(2)}% APR`;
}

/**
 * Funding & fee competitiveness: shows Realyx's funding next to the equivalent
 * Binance perp's funding, annualized, with a fairness verdict. Proves the
 * venue's funding is fair rather than asking traders to take it on faith.
 */
export function FundingComparePanel({ symbol, fundingRate, side = 'long', className }: FundingComparePanelProps) {
    const { referenceRate8h, hasReference, loading } = useReferenceFunding(symbol);
    const cmp = compareFunding(fundingRate, referenceRate8h, side);
    const meta = FAIRNESS_META[cmp.fairness];

    const Icon = cmp.fairness === 'tighter' ? TrendingDown : cmp.fairness === 'wider' ? TrendingUp : Minus;

    return (
        <div className={clsx('rounded-xl p-3.5 border border-line/60 bg-surface-3/40 shadow-sm overflow-hidden', className)}>
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--primary)]" />
                    Funding fairness
                </span>
                <span className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border', meta.bg, meta.tone)}>
                    <Icon className="w-3 h-3" aria-hidden />
                    {meta.label}
                </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {/* Realyx */}
                <div className="rounded-lg bg-[var(--bg-secondary)] border border-line/50 px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Realyx</div>
                    <div className="text-sm font-mono font-bold text-text-primary tabular-nums">{cmp.realyxLabel}</div>
                    <div className="text-[10px] text-text-muted tabular-nums mt-0.5">{aprLabel(cmp.realyxApr)} · 8h</div>
                </div>

                {/* Reference */}
                <div className="rounded-lg bg-[var(--bg-secondary)] border border-line/50 px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Binance perp</div>
                    {!hasReference ? (
                        <div className="text-sm font-mono font-bold text-text-muted tabular-nums">n/a</div>
                    ) : loading && referenceRate8h == null ? (
                        <div className="text-sm font-mono font-bold text-text-muted tabular-nums">…</div>
                    ) : cmp.referenceRate8h == null ? (
                        <div className="text-sm font-mono font-bold text-text-muted tabular-nums">unavailable</div>
                    ) : (
                        <>
                            <div className="text-sm font-mono font-bold text-text-primary tabular-nums">
                                {cmp.referenceRate8h > 0 ? '+' : ''}{(cmp.referenceRate8h * 100).toFixed(4)}%
                            </div>
                            <div className="text-[10px] text-text-muted tabular-nums mt-0.5">
                                {aprLabel(cmp.referenceApr ?? 0)} · 8h
                            </div>
                        </>
                    )}
                </div>
            </div>

            {cmp.spreadBps8h != null && (
                <div className="mt-2.5 text-[10px] text-text-muted leading-snug">
                    Spread {cmp.spreadBps8h.toFixed(2)} bps / 8h vs. the reference perp. Funding is settled on-chain every 8h to balance long/short demand.
                </div>
            )}
            {!hasReference && (
                <div className="mt-2.5 text-[10px] text-text-muted leading-snug">
                    No centralized perp exists for this RWA, so there is no external funding to compare against.
                </div>
            )}
        </div>
    );
}
