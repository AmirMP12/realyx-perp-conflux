import { useState } from 'react';
import clsx from 'clsx';
import { TradingViewWidget } from '../TradingViewWidget';
import { MarketLogo } from '../MarketLogo';
import type { Market } from '../../services/markets';
import { PriceTicker } from '../ui/PriceTicker';

interface ChartPanelProps {
    market: Market | undefined;
    currentPrice: number;
    className?: string;
}

const INTERVALS = ['15m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

/**
 * Chart surface with a clean toolbar header: market identity, live price, and
 * an interval selector wired into the TradingView widget.
 */
export function ChartPanel({ market, currentPrice, className }: ChartPanelProps) {
    const [interval, setInterval] = useState<Interval>('1h');
    const change24h = market?.change24h ?? 0;
    const isPositive = change24h >= 0;

    return (
        <div className={clsx('flex flex-col glass-panel glass-panel-elevated relative overflow-hidden rounded-2xl', className)}>
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-line/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <MarketLogo src={market?.image} symbol={market?.symbol ?? ''} name={market?.name} size="sm" className="rounded-full shrink-0" />
                    <span className="text-sm font-bold text-text-primary truncate">{market?.symbol ?? '—'}</span>
                    <span className="hidden sm:inline text-xs text-text-muted tabular-nums">
                        <PriceTicker value={currentPrice} prefix="$" decimals={currentPrice < 1 ? 4 : 2} className="text-text-secondary font-mono" />
                    </span>
                    <span className={clsx('hidden sm:inline text-xs font-semibold tabular-nums', isPositive ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                        {isPositive ? '+' : ''}{change24h.toFixed(2)}%
                    </span>
                </div>

                <div className="flex items-center rounded-lg bg-surface-3/60 border border-line/60 p-0.5 gap-0.5 shrink-0">
                    {INTERVALS.map((iv) => (
                        <button
                            key={iv}
                            type="button"
                            onClick={() => setInterval(iv)}
                            className={clsx(
                                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                interval === iv
                                    ? 'bg-[var(--bg-secondary)] text-text-primary shadow-sm'
                                    : 'text-text-secondary hover:text-text-primary',
                            )}
                        >
                            {iv}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart */}
            <div className="relative flex-1 min-h-0">
                <div className="w-full h-full absolute inset-0">
                    <TradingViewWidget marketSymbol={market?.symbol} interval={interval} />
                </div>
            </div>
        </div>
    );
}
