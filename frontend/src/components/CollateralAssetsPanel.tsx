import clsx from 'clsx';
import { Layers, ShieldCheck, Info } from 'lucide-react';

import { useCollateralAssets, formatHaircut, type CollateralAsset } from '../hooks/useCollateral';
import { formatCompact } from '../utils/format';
import { Skeleton } from './ui';

interface CollateralAssetsPanelProps {
    className?: string;
    /** Show the connected user's per-token balance column. */
    showBalances?: boolean;
}

/**
 * Registry-driven overview of every collateral the protocol accepts: USDC plus
 * each token registered in the on-chain CollateralRegistry, with per-asset
 * haircuts and protocol-exposure usage. Renders nothing when no CollateralRegistry
 * is configured for the active deployment.
 */
export function CollateralAssetsPanel({ className, showBalances = true }: CollateralAssetsPanelProps) {
    const { usdc, altAssets, registryConfigured, ordersEnabled, loading } = useCollateralAssets();

    if (!registryConfigured) return null;

    return (
        <div className={clsx('glass-panel overflow-hidden', className)}>
            <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                        <Layers className="w-4 h-4 text-indigo-400" />
                    </div>
                    <h3 className="text-sm font-bold text-text-primary uppercase tracking-wide">Accepted Collateral</h3>
                </div>
                <span
                    className={clsx(
                        'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border',
                        ordersEnabled
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                    )}
                >
                    {ordersEnabled ? 'Live' : 'USDC only'}
                </span>
            </div>

            <div className="p-3 sm:p-4">
                {loading ? (
                    <div className="space-y-2">
                        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <CollateralRow asset={usdc} showBalances={showBalances} canTrade />
                        {altAssets.map((a) => (
                            <CollateralRow key={a.address} asset={a} showBalances={showBalances} canTrade={ordersEnabled && a.enabled} />
                        ))}
                        {altAssets.length === 0 && (
                            <div className="flex items-start gap-2 rounded-xl border border-dashed border-line/70 bg-surface-3/40 px-3 py-3">
                                <Info className="w-4 h-4 text-text-muted shrink-0 mt-px" />
                                <p className="text-xs text-text-muted leading-relaxed">
                                    No alternative collateral is registered yet. USDC is the active settlement asset. Governance can
                                    register tokens (e.g. USDT0, AxCNH) with per-asset haircuts via the CollateralRegistry.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {!ordersEnabled && altAssets.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                        <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-px" />
                        <p className="text-[11px] text-amber-200/80 leading-relaxed">
                            These tokens are registered and valued on-chain, but the active deployment settles orders in USDC.
                            Posting margin in alt collateral unlocks once governance enables it.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function CollateralRow({ asset, showBalances, canTrade }: { asset: CollateralAsset; showBalances: boolean; canTrade: boolean }) {
    const util = asset.exposureUtilization;
    return (
        <div className="rounded-xl border border-line/50 bg-surface-3/40 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span
                        className={clsx(
                            'w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0',
                            asset.isUSDC ? 'bg-emerald-500/15 text-emerald-400' : 'bg-indigo-500/15 text-indigo-300',
                        )}
                    >
                        {asset.isUSDC ? '$' : asset.symbol.replace(/[-/].*$/, '').slice(0, 3).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-text-primary truncate">{asset.symbol}</span>
                            {!asset.enabled && !asset.isUSDC && (
                                <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">Paused</span>
                            )}
                        </div>
                        <span className="text-[11px] text-text-muted">
                            {asset.isUSDC ? 'Settlement asset · no haircut' : `${formatHaircut(asset.baseHaircutBps)} base haircut`}
                        </span>
                    </div>
                </div>

                <div className="text-right shrink-0">
                    {showBalances && (
                        <div className="text-sm font-mono font-semibold text-text-primary">
                            {asset.isUSDC
                                ? '—'
                                : asset.balanceFormatted > 0
                                    ? `${asset.balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
                                    : '0'}
                        </div>
                    )}
                    {!asset.isUSDC && asset.balanceFormatted > 0 && (
                        <div className="text-[11px] text-text-muted font-mono">≈ ${asset.effectiveUsdcFormatted.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    )}
                    {asset.isUSDC && (
                        <span className="text-[10px] font-medium text-emerald-400">Tradable</span>
                    )}
                    {!asset.isUSDC && (
                        <span className={clsx('text-[10px] font-medium', canTrade ? 'text-emerald-400' : 'text-text-muted')}>
                            {canTrade ? 'Tradable' : 'View only'}
                        </span>
                    )}
                </div>
            </div>

            {!asset.isUSDC && asset.maxProtocolExposure > 0n && (
                <div className="mt-2.5">
                    <div className="flex justify-between text-[10px] text-text-muted mb-1">
                        <span>Protocol exposure</span>
                        <span className="font-mono">
                            {formatCompact(asset.effectiveUsdcFormatted >= 0 ? Number(asset.exposureUsdc) / 1e6 : 0)} / {formatCompact(Number(asset.maxProtocolExposure) / 1e6)}
                        </span>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                        <div
                            className={clsx(
                                'h-full rounded-full transition-all',
                                (util ?? 0) > 0.85 ? 'bg-rose-500' : (util ?? 0) > 0.6 ? 'bg-amber-400' : 'bg-[var(--primary)]',
                            )}
                            style={{ width: `${Math.min(100, (util ?? 0) * 100)}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
