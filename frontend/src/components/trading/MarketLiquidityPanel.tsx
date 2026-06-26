import { useMemo } from 'react';
import { Zap, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { Address } from 'viem';

import { Market } from '../../services/markets';
import { useSingleMarketData } from '../../hooks/useMarketData';
import { useVaultStats } from '../../hooks/useVault';
import { formatCompact, formatPriceWithPrecision } from '../../utils/format';
import { PriceTicker } from '../ui/PriceTicker';
import { Tooltip } from '../ui/Tooltip';
import { FundingCountdown } from './FundingCountdown';

interface MarketLiquidityPanelProps {
    market: Market | undefined;
    /** Live mark price (Pyth display price) shown in the rest of the trade view. */
    currentPrice: number;
    className?: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Replaces the old simulated order book. Realyx prices trades off Pyth against a
 * shared liquidity vault — there is no matching engine and therefore no real
 * book — so this panel surfaces what actually governs execution: the oracle
 * mark/index price (with confidence), open-interest skew, funding, and the real
 * on-chain capacity (vault liquidity, per-position and market exposure caps).
 *
 * Laid out as a compact horizontal strip (sits beneath the chart) so it stays
 * sized to its content instead of stretching to fill a tall column.
 */
export function MarketLiquidityPanel({ market, currentPrice, className }: MarketLiquidityPanelProps) {
    const marketAddress = market?.marketAddress;
    const shouldFetch =
        !!marketAddress && marketAddress !== ZERO_ADDRESS && marketAddress !== '0x...';

    const { formatted, isLoading } = useSingleMarketData(
        shouldFetch ? (marketAddress as Address) : undefined,
    );
    const { stats: vaultStats } = useVaultStats();

    // Prefer live on-chain reads; fall back to the indexer-backed market object.
    const longOI = formatted?.longOI ?? market?.longOI ?? 0;
    const shortOI = formatted?.shortOI ?? market?.shortOI ?? 0;
    const totalOI = longOI + shortOI;
    const fundingRate = formatted?.fundingRate ?? market?.fundingRate ?? 0;

    // On-chain oracle (index) price + Pyth confidence band.
    const indexPrice = formatted?.price && formatted.price > 0 ? formatted.price : currentPrice;
    const confidence = formatted?.confidence ?? 0;
    const confidencePct = indexPrice > 0 && confidence > 0 ? (confidence / indexPrice) * 100 : 0;

    const maxPositionSize = formatted?.maxPositionSize ?? 0;
    const maxTotalExposure = formatted?.maxTotalExposure ?? 0;
    const availableLiquidity = vaultStats?.availableLiquidity ?? 0;

    const longPct = totalOI > 0 ? (longOI / totalOI) * 100 : 50;
    const shortPct = 100 - longPct;

    // Remaining notional that can be added at the mark price, bounded by the
    // market exposure cap, the vault liquidity, and the single-position cap.
    const availableDepth = useMemo(
        () => computeAvailableDepth({ maxPositionSize, maxTotalExposure, totalOI, availableLiquidity }),
        [maxPositionSize, maxTotalExposure, totalOI, availableLiquidity],
    );

    const marketCapacityUsed =
        maxTotalExposure > 0 ? Math.min(100, (totalOI / maxTotalExposure) * 100) : 0;

    const fundingClass =
        fundingRate > 0 ? 'text-[var(--short)]' : fundingRate < 0 ? 'text-[var(--long)]' : 'text-amber-400';

    return (
        <div
            className={clsx(
                'bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl overflow-hidden flex flex-col',
                className,
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-color)] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-semibold text-text-primary text-sm truncate">Market Liquidity</h3>
                    <Tooltip
                        content="Realyx is oracle-priced against a shared vault — trades fill at the Pyth price with no order book and no price impact."
                        side="top"
                    >
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                            <Zap className="w-3 h-3" />
                            Zero slippage
                        </span>
                    </Tooltip>
                </div>
                {confidence > 0 && (
                    <Tooltip content="Pyth confidence interval — the oracle's reported price uncertainty." side="top">
                        <span className="hidden sm:inline text-[11px] text-text-muted font-mono cursor-help">
                            conf ±${formatPriceWithPrecision(confidence)}
                            {confidencePct > 0 && ` (${confidencePct.toFixed(3)}%)`}
                        </span>
                    </Tooltip>
                )}
            </div>

            {/* Horizontal stat grid — wraps on small screens, single row on wide.
                Uses a 1px gap over a border-colored background so separator lines
                render correctly regardless of how cells wrap (divide-x/y break on
                multi-row grids because they follow DOM order, not grid position). */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-[var(--border-color)]">
                {/* Prices */}
                <Cell>
                    <CellLabel hint="Live Pyth price used to open, close, and value positions.">Mark / Index</CellLabel>
                    <PriceTicker
                        value={currentPrice}
                        prefix="$"
                        decimals={currentPrice < 1 ? 4 : 2}
                        className="text-text-primary font-mono font-semibold text-sm"
                    />
                    <span className="text-[11px] text-text-muted font-mono">
                        idx ${formatPriceWithPrecision(indexPrice)}
                    </span>
                </Cell>

                {/* OI skew */}
                <Cell>
                    <div className="flex items-center justify-between">
                        <CellLabel hint="Total notional held by longs vs shorts. The vault is the counterparty to the net imbalance.">
                            OI Skew
                        </CellLabel>
                        <span className="font-mono text-[11px] text-text-primary tabular-nums">{formatCompact(totalOI)}</span>
                    </div>
                    {isLoading && totalOI === 0 ? (
                        <div className="h-2 rounded-full bg-[var(--bg-tertiary)] animate-pulse mt-1" />
                    ) : (
                        <>
                            <div className="flex h-2 w-full rounded-full overflow-hidden bg-[var(--bg-tertiary)] mt-1.5">
                                <div className="bg-[var(--long)] h-full transition-all duration-500" style={{ width: `${longPct}%` }} />
                                <div className="bg-[var(--short)] h-full transition-all duration-500" style={{ width: `${shortPct}%` }} />
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-mono mt-1">
                                <span className="text-[var(--long)]">{longPct.toFixed(0)}% L</span>
                                <span className="text-[var(--short)]">S {shortPct.toFixed(0)}%</span>
                            </div>
                        </>
                    )}
                </Cell>

                {/* Funding */}
                <Cell>
                    <CellLabel hint="Funding paid between longs and shorts to balance OI, settled every 8h. Positive = longs pay shorts.">
                        Funding / 8h
                    </CellLabel>
                    <span className={clsx('font-mono text-sm tabular-nums', fundingClass)}>
                        {fundingRate > 0 ? '+' : ''}
                        {(fundingRate * 100).toFixed(4)}%
                    </span>
                    <FundingCountdown />
                </Cell>

                {/* Available depth */}
                <Cell>
                    <CellLabel hint="Remaining notional that can be added at the mark price before hitting the market's exposure cap or vault liquidity. Derived from on-chain limits — not a quote book.">
                        Available Depth
                    </CellLabel>
                    <span className="font-mono text-sm text-text-primary tabular-nums">
                        {availableDepth > 0 ? formatCompact(availableDepth) : '—'}
                    </span>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider">at mark</span>
                </Cell>

                {/* Capacity / limits */}
                <Cell className="col-span-2 lg:col-span-1">
                    <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <Tooltip content="USDC the vault can deploy as counterparty right now." side="top">
                                <span className="cursor-help">Vault Liq</span>
                            </Tooltip>
                        </span>
                        <span className="font-mono text-[11px] text-text-primary tabular-nums">{formatCompact(availableLiquidity)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-1">
                        <Tooltip content="Largest single position notional allowed on this market." side="top">
                            <span className="text-[11px] text-text-secondary cursor-help">Max Pos</span>
                        </Tooltip>
                        <span className="font-mono text-[11px] text-text-primary tabular-nums">
                            {maxPositionSize > 0 ? formatCompact(maxPositionSize) : '—'}
                        </span>
                    </div>
                    <div className="mt-1.5">
                        <div className="flex items-center justify-between text-[10px] mb-1">
                            <Tooltip content="Total open interest versus the market's maximum allowed exposure." side="top">
                                <span className="text-text-muted cursor-help">Capacity</span>
                            </Tooltip>
                            <span className="font-mono text-text-muted tabular-nums">{marketCapacityUsed.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                            <div
                                className={clsx(
                                    'h-full rounded-full transition-all duration-500',
                                    marketCapacityUsed > 85 ? 'bg-[var(--short)]' : marketCapacityUsed > 60 ? 'bg-amber-400' : 'bg-[var(--primary)]',
                                )}
                                style={{ width: `${marketCapacityUsed}%` }}
                            />
                        </div>
                    </div>
                </Cell>
            </div>
        </div>
    );
}

interface DepthInput {
    maxPositionSize: number;
    maxTotalExposure: number;
    totalOI: number;
    availableLiquidity: number;
}

/**
 * Remaining notional that can be added at the mark price, from real on-chain
 * limits: bounded by the market exposure cap (`maxTotalExposure - totalOI`),
 * the vault liquidity that can back new positions, and the single-position cap.
 */
function computeAvailableDepth({ maxPositionSize, maxTotalExposure, totalOI, availableLiquidity }: DepthInput): number {
    const exposureRoom = maxTotalExposure > 0 ? Math.max(0, maxTotalExposure - totalOI) : Infinity;
    const liquidityRoom = availableLiquidity > 0 ? availableLiquidity : Infinity;
    let headroom = Math.min(exposureRoom, liquidityRoom);

    if (!Number.isFinite(headroom) || headroom <= 0) {
        headroom = maxPositionSize > 0 ? maxPositionSize : 0;
    }
    return headroom;
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={clsx('flex flex-col gap-0.5 px-3 py-2.5 min-w-0 bg-[var(--bg-secondary)]', className)}>{children}</div>;
}

function CellLabel({ children, hint }: { children: React.ReactNode; hint: string }) {
    return (
        <Tooltip content={hint} side="top">
            <span className="text-[10px] uppercase tracking-[0.1em] text-text-muted font-medium cursor-help">{children}</span>
        </Tooltip>
    );
}

export default MarketLiquidityPanel;
