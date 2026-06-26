import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Info, Layers } from 'lucide-react';
import clsx from 'clsx';

import type { CollateralAsset } from '../../hooks/useCollateral';
import { formatHaircut } from '../../hooks/useCollateral';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface CollateralSelectorProps {
    assets: CollateralAsset[];
    selected: CollateralAsset;
    onSelect: (asset: CollateralAsset) => void;
    /** When false, alt collateral is shown but not selectable (orders settle in USDT0). */
    ordersEnabled: boolean;
    loading?: boolean;
    className?: string;
}

/**
 * Margin-asset picker for the trading form. Lists USDT0 plus every token registered
 * in the on-chain CollateralRegistry, showing each token's haircut and the user's
 * post-haircut spending power. When the deployed TradingCore has alt collateral
 * disabled, the alt rows are visible (informational) but locked to USDT0.
 */
export function CollateralSelector({
    assets,
    selected,
    onSelect,
    ordersEnabled,
    loading,
    className,
}: CollateralSelectorProps) {
    const [open, setOpen] = useState(false);
    const panelRef = useFocusTrap(open);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const hasAlt = assets.some((a) => !a.isUSDC);

    const sorted = useMemo(() => {
        // USDT0 first, then enabled alt tokens, then disabled ones.
        return [...assets].sort((a, b) => {
            if (a.isUSDC) return -1;
            if (b.isUSDC) return 1;
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.symbol.localeCompare(b.symbol);
        });
    }, [assets]);

    // With only USDT0 available there's nothing to pick — render a static chip.
    if (!hasAlt) {
        return (
            <div className={clsx('flex items-center justify-between', className)}>
                <span className="text-xs text-text-secondary">Collateral</span>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                    <span className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-400 grid place-items-center text-[9px] font-bold">$</span>
                    USDT0
                </span>
            </div>
        );
    }

    const isLocked = (a: CollateralAsset) => !a.isUSDC && (!ordersEnabled || !a.enabled);

    const handleSelect = (a: CollateralAsset) => {
        if (isLocked(a)) return;
        onSelect(a);
        setOpen(false);
        triggerRef.current?.focus();
    };

    return (
        <div className={clsx('relative', className)}>
            <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <Layers className="w-3.5 h-3.5" />
                    Collateral
                </span>
                {!ordersEnabled && (
                    <span className="text-[10px] text-text-muted">Settles in USDT0</span>
                )}
            </div>

            <button
                ref={triggerRef}
                type="button"
                data-testid="collateral-selector"
                onClick={() => setOpen((v) => !v)}
                disabled={loading}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-2 rounded-xl bg-[var(--bg-secondary)] border border-line/70 px-3 py-2.5 hover:border-brand/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60"
            >
                <span className="flex items-center gap-2 min-w-0">
                    <AssetGlyph symbol={selected.symbol} isUSDC={selected.isUSDC} />
                    <span className="font-semibold text-sm text-text-primary truncate">{selected.symbol}</span>
                    {!selected.isUSDC && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                            {formatHaircut(selected.baseHaircutBps)} haircut
                        </span>
                    )}
                </span>
                <ChevronDown className={clsx('w-4 h-4 text-text-muted transition-transform shrink-0', open && 'rotate-180')} />
            </button>

            <AnimatePresence>
                {open && (
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} aria-hidden="true" />
                        <motion.div
                            ref={panelRef}
                            role="listbox"
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.12 }}
                            className="absolute left-0 right-0 top-full mt-1.5 z-[70] rounded-xl bg-[var(--bg-secondary)] border border-line/70 shadow-2xl overflow-hidden max-h-72 overflow-y-auto custom-scrollbar"
                        >
                            {sorted.map((a) => {
                                const locked = isLocked(a);
                                const isSelected = a.address.toLowerCase() === selected.address.toLowerCase();
                                return (
                                    <button
                                        key={a.address}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        disabled={locked}
                                        onClick={() => handleSelect(a)}
                                        className={clsx(
                                            'w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors border-b border-line/40 last:border-b-0',
                                            locked ? 'cursor-not-allowed opacity-55' : 'hover:bg-surface-3/70',
                                            isSelected && 'bg-brand/10',
                                        )}
                                    >
                                        <span className="flex items-center gap-2.5 min-w-0">
                                            <AssetGlyph symbol={a.symbol} isUSDC={a.isUSDC} />
                                            <span className="min-w-0">
                                                <span className="flex items-center gap-1.5">
                                                    <span className="font-semibold text-sm text-text-primary truncate">{a.symbol}</span>
                                                    {a.isUSDC ? (
                                                        <span className="text-[10px] text-emerald-400">No haircut</span>
                                                    ) : (
                                                        <span className="text-[10px] text-amber-400">{formatHaircut(a.baseHaircutBps)} haircut</span>
                                                    )}
                                                </span>
                                                <span className="block text-[11px] text-text-muted font-mono">
                                                    {a.isUSDC
                                                        ? 'Settlement asset'
                                                        : `Bal ${a.balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 4 })} · ≈$${a.effectiveUsdcFormatted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                                </span>
                                            </span>
                                        </span>
                                        {isSelected ? (
                                            <Check className="w-4 h-4 text-[var(--primary)] shrink-0" />
                                        ) : locked && !a.isUSDC ? (
                                            <span className="text-[9px] uppercase tracking-wide text-text-muted shrink-0">
                                                {a.enabled ? 'Soon' : 'Paused'}
                                            </span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {!selected.isUSDC && (
                <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-3/50 border border-line/50 px-2.5 py-2">
                    <Info className="w-3.5 h-3.5 text-text-muted shrink-0 mt-px" />
                    <span className="text-[10px] leading-snug text-text-muted">
                        A {formatHaircut(selected.baseHaircutBps)} haircut is applied to {selected.symbol} when valuing your margin. Position PnL still settles in USDT0.
                    </span>
                </div>
            )}
        </div>
    );
}

function AssetGlyph({ symbol, isUSDC }: { symbol: string; isUSDC: boolean }) {
    return (
        <span
            className={clsx(
                'w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold shrink-0',
                isUSDC ? 'bg-emerald-500/15 text-emerald-400' : 'bg-indigo-500/15 text-indigo-300',
            )}
        >
            {isUSDC ? '$' : symbol.replace(/[-/].*$/, '').slice(0, 3).toUpperCase()}
        </span>
    );
}
