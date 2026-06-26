import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import clsx from 'clsx';
import { CATEGORY_CONFIG } from '../config/markets';
import { formatCompact } from '../utils/format';
import { isEquityCategory } from '../utils/marketHours';
import { MarketSessionBadge } from './MarketSessionBadge';

type Category = 'CRYPTO' | 'STOCK' | 'COMMODITY' | 'FOREX';

interface PositionLike {
    marketAddress: string;
    size: string;
    isLong: boolean;
}

interface MarketLike {
    marketAddress?: string;
    category?: string;
}

interface CategoryBucket {
    category: Category;
    long: number;
    short: number;
    total: number;
    count: number;
}

const CATEGORY_ORDER: Category[] = ['CRYPTO', 'STOCK', 'COMMODITY', 'FOREX'];

const CATEGORY_BAR: Record<Category, string> = {
    CRYPTO: 'bg-emerald-400',
    STOCK: 'bg-sky-400',
    COMMODITY: 'bg-amber-400',
    FOREX: 'bg-indigo-400',
};

/**
 * Unified cross-asset exposure breakdown — groups open positions by asset class
 * (crypto / equities / commodities / forex) and shows notional + long/short
 * split per class. A pure-crypto perp DEX has nothing like this; for Realyx it
 * makes the multi-asset RWA venue legible at a glance.
 */
export function CrossAssetExposure({
    positions,
    markets,
}: {
    positions: PositionLike[];
    markets: MarketLike[];
}) {
    const { buckets, grandTotal } = useMemo(() => {
        const byAddr = new Map<string, string>();
        for (const m of markets) {
            if (m.marketAddress) byAddr.set(m.marketAddress.toLowerCase(), (m.category ?? 'CRYPTO').toUpperCase());
        }

        const map = new Map<Category, CategoryBucket>();
        for (const cat of CATEGORY_ORDER) {
            map.set(cat, { category: cat, long: 0, short: 0, total: 0, count: 0 });
        }

        for (const p of positions) {
            const rawCat = byAddr.get((p.marketAddress || '').toLowerCase()) ?? 'CRYPTO';
            const cat = (CATEGORY_ORDER.includes(rawCat as Category) ? rawCat : 'CRYPTO') as Category;
            const notional = parseFloat(p.size || '0');
            if (!Number.isFinite(notional) || notional <= 0) continue;
            const b = map.get(cat)!;
            if (p.isLong) b.long += notional;
            else b.short += notional;
            b.total += notional;
            b.count += 1;
        }

        const buckets = CATEGORY_ORDER.map((c) => map.get(c)!).filter((b) => b.total > 0);
        const grandTotal = buckets.reduce((s, b) => s + b.total, 0);
        return { buckets, grandTotal };
    }, [positions, markets]);

    if (buckets.length === 0) return null;

    return (
        <div className="glass-panel p-5 sm:p-6" aria-label="Cross-asset exposure">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                    <Layers className="w-5 h-5 text-[var(--primary)]" />
                    Cross-Asset Exposure
                </h2>
                <span className="text-xs text-text-secondary tabular-nums">
                    {formatCompact(grandTotal)} total notional
                </span>
            </div>

            {/* Aggregate allocation bar across all asset classes. */}
            <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-[var(--bg-tertiary)] mb-5">
                {buckets.map((b) => (
                    <div
                        key={`alloc-${b.category}`}
                        className={clsx('h-full', CATEGORY_BAR[b.category])}
                        style={{ width: `${(b.total / grandTotal) * 100}%` }}
                        title={`${CATEGORY_CONFIG[b.category]?.label ?? b.category}: ${formatCompact(b.total)}`}
                    />
                ))}
            </div>

            <div className="space-y-3.5">
                {buckets.map((b) => {
                    const longPct = b.total > 0 ? (b.long / b.total) * 100 : 0;
                    const allocPct = grandTotal > 0 ? (b.total / grandTotal) * 100 : 0;
                    return (
                        <div key={b.category}>
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    <span className={clsx('inline-block w-2.5 h-2.5 rounded-sm', CATEGORY_BAR[b.category])} />
                                    <span className="text-sm font-semibold text-text-primary">
                                        {CATEGORY_CONFIG[b.category]?.label ?? b.category}
                                    </span>
                                    <span className="text-[11px] text-text-muted">
                                        {b.count} {b.count === 1 ? 'position' : 'positions'}
                                    </span>
                                    {isEquityCategory(b.category) && <MarketSessionBadge category={b.category} compact />}
                                </div>
                                <div className="text-sm font-mono font-semibold text-text-primary tabular-nums">
                                    {formatCompact(b.total)}
                                    <span className="text-[11px] text-text-muted ml-1.5">{allocPct.toFixed(0)}%</span>
                                </div>
                            </div>
                            {/* Long/short split within the class. */}
                            <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-[var(--bg-secondary)]">
                                <div className="h-full bg-[var(--long)]" style={{ width: `${longPct}%` }} />
                                <div className="h-full bg-[var(--short)]" style={{ width: `${100 - longPct}%` }} />
                            </div>
                            <div className="flex justify-between text-[10px] text-text-muted mt-1 tabular-nums">
                                <span className="text-[var(--long)]">Long {formatCompact(b.long)}</span>
                                <span className="text-[var(--short)]">Short {formatCompact(b.short)}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
