import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Edit2, Shield, Wallet, Clock, FileText, ArrowRightLeft } from 'lucide-react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Market } from '../../services/markets';
import { Position } from '../../hooks/usePositions';
import { useSetStopLoss, useSetTakeProfit, useSetTrailingStop, useCancelOrder } from '../../hooks/useProgram';
import { usePendingOrders, getOrderTypeLabel } from '../../hooks/usePendingOrders';
import { useSettingsStore } from '../../stores/settingsStore';
import { showToast } from '../ui/Toast';
import { TradeHistoryItem } from '../../hooks/useBackend';
import { CollateralEditModal } from './CollateralEditModal';
import { ClosePositionModal } from './ClosePositionModal';
import { TransferPositionModal } from './TransferPositionModal';
import { Skeleton } from '../ui/Skeleton';
import { formatPriceWithPrecision } from '../../utils/format';

function fmtUsdPrice(n: number): string {
    return `$${formatPriceWithPrecision(n)}`;
}

/** Allows only a valid decimal string (no browser number spinners). */
function filterDecimalInput(raw: string): string {
    const t = raw.replace(/[^\d.]/g, '');
    if (!t) return '';
    const parts = t.split('.');
    if (parts.length === 1) return parts[0];
    return `${parts[0]}.${parts.slice(1).join('')}`;
}

function filterUnsignedIntInput(raw: string): string {
    return raw.replace(/\D/g, '');
}

interface SlTpModalState {
    id: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    trailingStopBps: number;
    symbol: string;
    isLong: boolean;
}

interface PositionTableProps {
    positions: Position[];
    positionsLoading: boolean;
    tradeHistory: TradeHistoryItem[];
    historyLoading: boolean;
    markets: Market[];
    fetchPositions: () => void;
}

export function PositionTable({
    positions,
    positionsLoading,
    tradeHistory,
    historyLoading,
    markets,
    fetchPositions
}: PositionTableProps) {
    const settings = useSettingsStore();
    const cellPad = settings.compactMode ? 'px-3 py-1.5' : 'px-4 py-3';
    const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'history' | 'trades'>('positions');

    const [slTpPosition, setSlTpPosition] = useState<SlTpModalState | null>(null);
    const [activeCollateralPos, setActiveCollateralPos] = useState<Position | null>(null);
    const [activeClosePos, setActiveClosePos] = useState<Position | null>(null);
    const [activeTransferPos, setActiveTransferPos] = useState<Position | null>(null);

    const { orders: pendingOrders, loading: ordersLoading, refetch: refetchOrders } = usePendingOrders();

    const [slTpStopLoss, setSlTpStopLoss] = useState('');
    const [slTpTakeProfit, setSlTpTakeProfit] = useState('');
    const [trailingStop, setTrailingStop] = useState('');

    const { setStopLoss, loading: slLoading } = useSetStopLoss();
    const { setTakeProfit, loading: tpLoading } = useSetTakeProfit();
    const { setTrailingStop: setTrailing, loading: trLoading } = useSetTrailingStop();
    const { cancelOrder, loading: cancellingOrder } = useCancelOrder();

    useEffect(() => {
        if (!slTpPosition) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSlTpPosition(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [slTpPosition]);

    const confirmSlTp = async () => {
        if (!slTpPosition) return;
        const parseUsd = (s: string) => parseFloat(s.replace(/,/g, '').trim());
        const sl = slTpStopLoss.trim() ? parseUsd(slTpStopLoss) : 0;
        const tp = slTpTakeProfit.trim() ? parseUsd(slTpTakeProfit) : 0;
        const tr = trailingStop.trim() ? parseFloat(trailingStop.replace(/,/g, '')) : 0; // bps

        if (isNaN(sl) || isNaN(tp) || sl < 0 || tp < 0 || isNaN(tr) || tr < 0) {
            showToast('error', 'Invalid', 'Enter valid prices (0 or empty to clear)');
            return;
        }

        try {
            const promises = [];
            if (sl !== slTpPosition.stopLossPrice) promises.push(setStopLoss(slTpPosition.id, sl));
            if (tp !== slTpPosition.takeProfitPrice) promises.push(setTakeProfit(slTpPosition.id, tp));
            if (tr !== slTpPosition.trailingStopBps) promises.push(setTrailing(slTpPosition.id, tr));

            await Promise.all(promises);

            setSlTpPosition(null);
            setTimeout(() => fetchPositions(), 2000);
        } catch (err: any) {
            showToast('error', 'Failed', err?.shortMessage || 'Failed to update position');
        }
    };

    return (
        <div className="flex flex-col h-full bg-[var(--bg-secondary)] border-t border-[var(--border-color)] lg:border-t-0">
            {/* Tabs */}
            <div className="flex items-center gap-6 px-4 border-b border-[var(--border-color)] overflow-x-auto">
                {(['positions', 'orders', 'history'] as const).map(sub => (
                    <button
                        key={sub}
                        type="button"
                        data-testid={`${sub}-tab`}
                        onClick={() => setActiveTab(sub)}
                        className={clsx(
                            "py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === sub
                                ? "border-[var(--primary)] text-white"
                                : "border-transparent text-text-secondary hover:text-text-primary"
                        )}
                    >
                        {sub === 'positions' ? `Positions ${positions.length > 0 ? `(${positions.length})` : ''}` :
                            sub.charAt(0).toUpperCase() + sub.slice(1)}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                {activeTab === 'positions' && (
                    positionsLoading && positions.length === 0 ? (
                        <div className="p-6 space-y-4">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-center gap-4 py-4 border-b border-[var(--border-color)] last:border-0">
                                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-4 w-16 ml-auto" />
                                    <Skeleton className="h-4 w-12" />
                                </div>
                            ))}
                        </div>
                    ) : positions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-4">
                            <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
                                <Wallet className="w-8 h-8 text-text-muted" />
                            </div>
                            <p className="font-semibold text-text-primary">No open positions</p>
                            <p className="text-sm text-text-secondary mt-1 text-center">Open a position to get started</p>
                            <Link to="/trade" className="mt-6 px-6 py-2.5 bg-[var(--primary)] text-white font-medium rounded-lg hover:opacity-90 transition-opacity">
                                Trade
                            </Link>
                        </div>
                    ) : (
                        <>
                            {/* Desktop Table */}
                            <div className="hidden md:block px-2 md:px-3 pb-3">
                                <div className="rounded-xl border border-[var(--border-color)]/70 bg-[var(--bg-secondary)]/40 overflow-x-auto custom-scrollbar shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                                    <table className="w-full min-w-[900px] text-left text-sm whitespace-nowrap">
                                    <thead className="text-[10px] text-text-muted uppercase tracking-wider bg-[var(--bg-tertiary)]/45 sticky top-0 z-10 border-b border-[var(--border-color)]/80">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Market</th>
                                            <th className="px-4 py-3 font-semibold text-right tabular-nums">Net Value</th>
                                            <th className="px-4 py-3 font-semibold text-right tabular-nums">Size</th>
                                            <th className="px-4 py-3 font-semibold text-right tabular-nums">Collateral</th>
                                            <th className="px-4 py-3 font-semibold text-right tabular-nums">Entry Price</th>
                                            <th className="px-4 py-3 font-semibold text-right tabular-nums">Mark Price</th>
                                            <th className="px-4 py-3 font-semibold text-right tabular-nums">Liq. Price</th>
                                            <th className="px-4 py-3 font-semibold text-right tabular-nums">PnL</th>
                                            <th className="px-4 py-3 font-semibold text-right pr-6">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border-color)]/80">
                                        {positions.map((pos: any, i: number) => (
                                            <PositionRow
                                                key={i}
                                                pos={pos}
                                                markets={markets}
                                                settings={settings}
                                                cellPad={cellPad}
                                                setActiveCollateralPos={setActiveCollateralPos}
                                                setActiveClosePos={setActiveClosePos}
                                                setActiveTransferPos={setActiveTransferPos}
                                                setSlTpPosition={setSlTpPosition}
                                                setSlTpStopLoss={setSlTpStopLoss}
                                                setSlTpTakeProfit={setSlTpTakeProfit}
                                                setTrailingStop={setTrailingStop}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </div>

                            {/* Mobile List */}
                            <div className="md:hidden px-3 pb-3 space-y-3">
                                {positions.map((pos: any, i: number) => (
                                    <MobilePositionCard
                                        key={i}
                                        pos={pos}
                                        markets={markets}
                                        settings={settings}
                                        setActiveCollateralPos={setActiveCollateralPos}
                                        setActiveClosePos={setActiveClosePos}
                                        setActiveTransferPos={setActiveTransferPos}
                                        setSlTpPosition={setSlTpPosition}
                                        setSlTpStopLoss={setSlTpStopLoss}
                                        setSlTpTakeProfit={setSlTpTakeProfit}
                                        setTrailingStop={setTrailingStop}
                                    />
                                ))}
                            </div>
                        </>
                    )
                )}

                {activeTab === 'orders' && (
                    ordersLoading ? (
                        <div className="p-6 space-y-4">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-4 py-4 border-b border-[var(--border-color)] last:border-0">
                                    <Skeleton className="h-4 w-16" />
                                    <Skeleton className="h-4 w-20" />
                                    <Skeleton className="h-4 w-12 ml-auto" />
                                </div>
                            ))}
                        </div>
                    ) : pendingOrders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-4">
                            <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
                                <Clock className="w-8 h-8 text-text-muted" />
                            </div>
                            <p className="font-semibold text-text-primary">No open orders</p>
                            <p className="text-sm text-text-secondary mt-1 text-center">Limit and stop orders will appear here</p>
                        </div>
                    ) : (
                        <>
                            {/* Desktop Orders */}
                            <div className="hidden md:block overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
                                <table className="w-full min-w-[400px] text-left text-sm whitespace-nowrap">
                                    <thead className="text-xs text-text-muted uppercase tracking-wider bg-[var(--bg-tertiary)]/30 sticky top-0 z-10">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Order ID</th>
                                            <th className="px-4 py-2 font-medium">Type</th>
                                            <th className="px-4 py-2 font-medium">Market</th>
                                            <th className="px-4 py-2 font-medium text-right">Status</th>
                                            <th className="px-4 py-2 font-medium text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border-color)]">
                                        {pendingOrders.map((order) => {
                                            const market = markets.find(m => m.marketAddress?.toLowerCase() === order.market?.toLowerCase());
                                            return (
                                                <tr key={order.orderId.toString()} className="hover:bg-[var(--bg-tertiary)]/40 transition-colors duration-150">
                                                    <td className="px-4 py-3 font-mono text-text-primary">
                                                        #{order.orderId.toString()}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={clsx(
                                                            "text-xs font-bold px-1.5 py-0.5 rounded",
                                                            order.orderType <= 1
                                                                ? "text-blue-400 bg-blue-500/10"
                                                                : "text-amber-400 bg-amber-500/10"
                                                        )}>
                                                            {getOrderTypeLabel(order.orderType)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-text-primary">
                                                        <div className="flex items-center gap-2">
                                                            {market && <img src={market.image} className="w-4 h-4 rounded-full" alt="" />}
                                                            {market?.symbol || order.market.slice(0, 8) + '...'}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                                                            Pending
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button
                                                            onClick={async () => {
                                                                const ok = await cancelOrder(order.orderId);
                                                                if (ok) refetchOrders();
                                                            }}
                                                            disabled={cancellingOrder}
                                                            className="text-xs font-bold text-[var(--short)] hover:text-red-300 bg-[var(--short)]/10 hover:bg-[var(--short)]/20 px-2 py-1 rounded transition-colors disabled:opacity-50"
                                                        >
                                                            {cancellingOrder ? 'Cancelling...' : 'Cancel'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Orders */}
                            <div className="md:hidden px-3 pb-3 space-y-3">
                                {pendingOrders.map((order) => (
                                    <MobileOrderCard
                                        key={order.orderId.toString()}
                                        order={order}
                                        markets={markets}
                                        onCancel={async () => {
                                            const ok = await cancelOrder(order.orderId);
                                            if (ok) refetchOrders();
                                        }}
                                        cancelling={cancellingOrder}
                                    />
                                ))}
                            </div>
                        </>
                    )
                )}

                {activeTab === 'history' && (
                    historyLoading && tradeHistory.length === 0 ? (
                        <div className="p-6 space-y-4">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="flex items-center gap-4 py-4 border-b border-[var(--border-color)] last:border-0">
                                    <Skeleton className="h-4 w-20" />
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-4 w-12 ml-auto" />
                                    <Skeleton className="h-4 w-14" />
                                </div>
                            ))}
                        </div>
                    ) : tradeHistory.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-4">
                            <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
                                <FileText className="w-8 h-8 text-text-muted" />
                            </div>
                            <p className="font-semibold text-text-primary">No trade history</p>
                            <p className="text-sm text-text-secondary mt-1 text-center">Your completed trades will appear here</p>
                        </div>
                    ) : (
                        <>
                            {/* Desktop History */}
                            <div className="hidden md:block overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
                                <table className="w-full min-w-[320px] text-left text-sm whitespace-nowrap">
                                    <thead className="text-xs text-text-muted uppercase tracking-wider bg-[var(--bg-tertiary)]/30 sticky top-0 z-10">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Time</th>
                                            <th className="px-4 py-2 font-medium">Action</th>
                                            <th className="px-4 py-2 font-medium text-right">Price</th>
                                            <th className="px-4 py-2 font-medium text-right">PnL</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border-color)]">
                                        {tradeHistory.map((t) => (
                                            <tr key={t.id} className="hover:bg-[var(--bg-tertiary)]/40 transition-colors duration-150">
                                                <td className="px-4 py-3 text-text-muted">
                                                    {new Date(t.timestamp).toLocaleTimeString()} <span className="text-[10px]">{new Date(t.timestamp).toLocaleDateString()}</span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col">
                                                        <span className={clsx("font-medium", t.side === 'LONG' ? "text-[var(--long)]" : "text-[var(--short)]")}>
                                                            {t.side} {t.market}
                                                        </span>
                                                        <span className="text-[10px] text-text-muted">{t.type}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-text-primary">
                                                    {fmtUsdPrice(parseFloat(t.price))}
                                                </td>
                                                <td className={clsx("px-4 py-3 text-right font-mono", t.pnl && parseFloat(t.pnl) >= 0 ? "text-[var(--long)]" : "text-[var(--short)]")}>
                                                    {t.pnl ? (parseFloat(t.pnl) >= 0 ? '+' : '') + parseFloat(t.pnl).toFixed(2) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile History */}
                            <div className="md:hidden px-3 pb-3 space-y-3">
                                {tradeHistory.map((t) => (
                                    <MobileHistoryCard key={t.id} t={t} />
                                ))}
                            </div>
                        </>
                    )
                )}
            </div>

            {/* Triggers Modal */}
            {createPortal(
                <AnimatePresence>
                    {slTpPosition && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center p-4 py-8 sm:py-4 bg-black/75 backdrop-blur-sm overflow-y-auto overscroll-contain"
                        role="presentation"
                        onClick={() => setSlTpPosition(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 8 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl max-w-md w-full max-h-[min(90dvh,720px)] my-auto flex flex-col overflow-hidden shadow-[0_24px_48px_rgba(0,0,0,0.45)]"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="position-triggers-title"
                        >
                            <div className="shrink-0 px-5 pt-5 pb-4 border-b border-[var(--border-color)]/80 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 id="position-triggers-title" className="text-lg font-bold text-text-primary tracking-tight">
                                        Position triggers
                                    </h2>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                                        <span className="font-medium text-text-secondary truncate">{slTpPosition.symbol}</span>
                                        <span
                                            className={clsx(
                                                'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md shrink-0',
                                                slTpPosition.isLong ? 'text-[var(--long)] bg-[var(--long)]/12' : 'text-[var(--short)] bg-[var(--short)]/12'
                                            )}
                                        >
                                            {slTpPosition.isLong ? 'Long' : 'Short'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-text-muted mt-2 leading-relaxed">
                                        Set stop loss, take profit, or a trailing distance. Use 0 or leave blank to clear a trigger.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSlTpPosition(null)}
                                    className="shrink-0 p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)] transition-colors"
                                    aria-label="Close"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5 space-y-5 custom-scrollbar">
                                <div>
                                    <label htmlFor="trigger-stop-loss" className="flex items-baseline justify-between gap-2 mb-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Stop loss</span>
                                        <span className="text-[10px] text-text-muted">USD</span>
                                    </label>
                                    <div className="relative rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-tertiary)]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus-within:border-[var(--primary)]/55 focus-within:ring-2 focus-within:ring-[var(--primary)]/15 transition-all">
                                        <input
                                            id="trigger-stop-loss"
                                            type="text"
                                            inputMode="decimal"
                                            autoComplete="off"
                                            value={slTpStopLoss}
                                            onChange={(e) => setSlTpStopLoss(filterDecimalInput(e.target.value))}
                                            placeholder="e.g. 1842.50"
                                            className="w-full min-w-0 bg-transparent border-0 rounded-xl py-3 pl-4 pr-4 font-mono text-sm text-text-primary placeholder:text-text-muted/50 outline-none ring-0"
                                        />
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-text-muted leading-snug">
                                        Market order when price hits this level (against your position).
                                    </p>
                                </div>
                                <div>
                                    <label htmlFor="trigger-take-profit" className="flex items-baseline justify-between gap-2 mb-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Take profit</span>
                                        <span className="text-[10px] text-text-muted">USD</span>
                                    </label>
                                    <div className="relative rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-tertiary)]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus-within:border-[var(--primary)]/55 focus-within:ring-2 focus-within:ring-[var(--primary)]/15 transition-all">
                                        <input
                                            id="trigger-take-profit"
                                            type="text"
                                            inputMode="decimal"
                                            autoComplete="off"
                                            value={slTpTakeProfit}
                                            onChange={(e) => setSlTpTakeProfit(filterDecimalInput(e.target.value))}
                                            placeholder="e.g. 2100.00"
                                            className="w-full min-w-0 bg-transparent border-0 rounded-xl py-3 pl-4 pr-4 font-mono text-sm text-text-primary placeholder:text-text-muted/50 outline-none ring-0"
                                        />
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-text-muted leading-snug">
                                        Lock in gains when price reaches this level in your favor.
                                    </p>
                                </div>
                                <div>
                                    <label htmlFor="trigger-trailing" className="flex items-baseline justify-between gap-2 mb-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Trailing stop</span>
                                        <span className="text-[10px] text-text-muted">BPS</span>
                                    </label>
                                    <div className="relative rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-tertiary)]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus-within:border-[var(--primary)]/55 focus-within:ring-2 focus-within:ring-[var(--primary)]/15 transition-all">
                                        <input
                                            id="trigger-trailing"
                                            type="text"
                                            inputMode="numeric"
                                            autoComplete="off"
                                            value={trailingStop}
                                            onChange={(e) => setTrailingStop(filterUnsignedIntInput(e.target.value))}
                                            placeholder="e.g. 100"
                                            className="w-full min-w-0 bg-transparent border-0 rounded-xl py-3 pl-4 pr-4 font-mono text-sm text-text-primary placeholder:text-text-muted/50 outline-none ring-0"
                                        />
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-text-muted leading-snug">
                                        Basis points from the best price (100 BPS = 1%). Use <span className="font-mono text-text-secondary">0</span> to turn off.
                                    </p>
                                </div>
                            </div>

                            <div className="shrink-0 px-5 pb-5 pt-4 border-t border-[var(--border-color)]/80 bg-[var(--bg-secondary)] flex flex-col-reverse sm:flex-row gap-3">
                                <button
                                    type="button"
                                    onClick={() => setSlTpPosition(null)}
                                    disabled={slLoading || tpLoading || trLoading}
                                    className="sm:flex-1 py-3 rounded-xl font-semibold text-sm text-text-secondary border border-[var(--border-color)] hover:bg-[var(--bg-tertiary)] hover:text-text-primary transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmSlTp}
                                    disabled={slLoading || tpLoading || trLoading}
                                    className="sm:flex-1 py-3 rounded-xl font-bold text-sm text-white bg-[var(--primary)] hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50 shadow-lg shadow-[var(--primary)]/20"
                                >
                                    {slLoading || tpLoading || trLoading ? 'Saving…' : 'Save triggers'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>,
            document.body
            )}

            <CollateralEditModal
                isOpen={!!activeCollateralPos}
                onClose={() => { setActiveCollateralPos(null); setTimeout(fetchPositions, 1000); }}
                position={activeCollateralPos}
            />

            <ClosePositionModal
                isOpen={!!activeClosePos}
                onClose={() => setActiveClosePos(null)}
                onCloseSuccess={() => {
                    void fetchPositions();
                    setTimeout(() => void fetchPositions(), 2000);
                }}
                position={activeClosePos}
            />

            <TransferPositionModal
                isOpen={!!activeTransferPos}
                onClose={() => setActiveTransferPos(null)}
                onSuccess={() => {
                    void fetchPositions();
                    setTimeout(() => void fetchPositions(), 2000);
                }}
                position={activeTransferPos}
            />
        </div>
    );
}

function PositionRow({
    pos,
    markets,
    settings,
    cellPad,
    setActiveCollateralPos,
    setActiveClosePos,
    setActiveTransferPos,
    setSlTpPosition,
    setSlTpStopLoss,
    setSlTpTakeProfit,
    setTrailingStop,
}: any) {
    const market = markets.find((m: any) => (m.marketAddress || '').toLowerCase() === (pos.marketAddress || '').toLowerCase());
    const pnl = Number(pos.livePnl ?? pos.pnl);
    const isProfit = pnl >= 0;
    const isOptimistic = (pos as any).isOptimistic || String(pos.id).startsWith('opt-');

    const slPrice = pos.stopLossPrice ? parseFloat(pos.stopLossPrice.toString()) : 0;
    const tpPrice = pos.takeProfitPrice ? parseFloat(pos.takeProfitPrice.toString()) : 0;
    const trBps = (pos as any).trailingStopBps ? parseFloat((pos as any).trailingStopBps.toString()) : 0;

    return (
        <tr data-testid="position-row" className="hover:bg-[var(--bg-tertiary)]/30 transition-colors duration-150">
            <td className={clsx(cellPad, "font-medium text-text-primary")}>
                <div className="flex items-center gap-2 min-w-0">
                    {market && <img src={market.image} className="w-6 h-6 rounded-full ring-1 ring-[var(--border-color)]/60 shrink-0" alt="" />}
                    <span className="truncate">{market?.symbol || 'Unknown'}</span>
                    <span className={clsx("text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 tracking-wide", pos.isLong ? "text-[var(--long)] bg-[var(--long)]/12" : "text-[var(--short)] bg-[var(--short)]/12")}>
                        {pos.isLong ? 'Long' : 'Short'}
                    </span>
                    {isOptimistic && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 animate-pulse">Pending</span>
                    )}
                </div>
            </td>
            <td className={clsx(cellPad, "text-right font-mono text-sm tabular-nums text-text-primary")}>
                ${Number(pos.size).toFixed(2)}
            </td>
            <td className={clsx(cellPad, "text-right font-mono text-sm tabular-nums text-text-primary")}>
                {(Number(pos.size) / (Number(pos.entryPrice) || 1)).toFixed(4)}
            </td>
            <td className={clsx(cellPad, "text-right font-mono text-sm tabular-nums text-text-primary")}>
                <div className="flex items-center justify-end gap-2 group">
                    ${Number(pos.collateral || (pos as any).margin).toFixed(2)}
                    {!isOptimistic && (
                        <button
                            onClick={() => setActiveCollateralPos(pos)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-[var(--bg-tertiary)] rounded-lg text-text-muted hover:text-text-primary transition-all focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                            title="Edit Collateral"
                        >
                            <Edit2 size={12} />
                        </button>
                    )}
                </div>
            </td>
            <td className={clsx(cellPad, "text-right font-mono text-sm tabular-nums text-text-primary")}>
                {fmtUsdPrice(Number(pos.entryPrice))}
            </td>
            <td className={clsx(cellPad, "text-right font-mono text-sm tabular-nums text-text-primary")}>
                {fmtUsdPrice(Number(pos.markPrice ?? pos.entryPrice))}
            </td>
            <td className={clsx(cellPad, "text-right font-mono text-sm tabular-nums text-orange-400")}>
                {fmtUsdPrice(Number(pos.liquidationPrice))}
            </td>
            <td className={clsx(cellPad, "text-right font-mono text-sm tabular-nums", isProfit ? "text-[var(--long)]" : "text-[var(--short)]")}>
                {settings.showPnlPercent && Number(pos.collateral) > 0 ? (
                    <>
                        {isProfit ? '+' : ''}{((pnl / Number(pos.collateral)) * 100).toFixed(1)}%
                        <span className="text-[10px] ml-1 opacity-70">
                            ({isProfit ? '+' : ''}${Math.abs(pnl).toFixed(2)})
                        </span>
                    </>
                ) : (
                    <>
                        {isProfit ? '+' : ''}{pnl.toFixed(2)}
                        {Number(pos.collateral) > 0 && (
                            <span className="text-[10px] ml-1 opacity-70">
                                ({isProfit ? '+' : ''}{((pnl / Number(pos.collateral)) * 100).toFixed(1)}%)
                            </span>
                        )}
                    </>
                )}
            </td>
            <td className={clsx(cellPad, "text-right pr-6")}>
                {isOptimistic ? (
                    <span className="text-xs text-text-muted">Confirming...</span>
                ) : (
                    <div className="flex items-center justify-end gap-1.5">
                        <button
                            onClick={() => {
                                setSlTpPosition({
                                    id: Number(pos.id),
                                    stopLossPrice: slPrice,
                                    takeProfitPrice: tpPrice,
                                    trailingStopBps: trBps,
                                    symbol: market?.symbol || 'Position',
                                    isLong: !!pos.isLong,
                                });
                                setSlTpStopLoss(slPrice > 0 ? formatPriceWithPrecision(slPrice) : '');
                                setSlTpTakeProfit(tpPrice > 0 ? formatPriceWithPrecision(tpPrice) : '');
                                setTrailingStop(trBps > 0 ? trBps.toString() : '');
                            }}
                            className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-text-secondary hover:text-text-primary transition-colors"
                            title="Edit Trigger Orders"
                            data-testid="trigger-btn"
                        >
                            <Shield className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTransferPos(pos)}
                            className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-text-secondary hover:text-[var(--primary)] transition-colors"
                            title="Transfer position NFT"
                            data-testid="transfer-position-btn"
                        >
                            <ArrowRightLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setActiveClosePos(pos)}
                            className="px-3 py-1.5 text-xs font-bold bg-[var(--bg-tertiary)] border border-[var(--border-color)]/80 hover:bg-white/10 text-text-primary rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                )}
            </td>
        </tr>
    );
}

function MobilePositionCard({
    pos,
    markets,
    settings,
    setActiveCollateralPos,
    setActiveClosePos,
    setActiveTransferPos,
    setSlTpPosition,
    setSlTpStopLoss,
    setSlTpTakeProfit,
    setTrailingStop,
}: any) {
    const market = markets.find((m: any) => (m.marketAddress || '').toLowerCase() === (pos.marketAddress || '').toLowerCase());
    const pnl = Number(pos.livePnl ?? pos.pnl);
    const isProfit = pnl >= 0;
    const netValue = Number(pos.size);
    const isOptimistic = (pos as any).isOptimistic || String(pos.id).startsWith('opt-');

    const slPrice = pos.stopLossPrice ? parseFloat(pos.stopLossPrice.toString()) : 0;
    const tpPrice = pos.takeProfitPrice ? parseFloat(pos.takeProfitPrice.toString()) : 0;
    const trBps = (pos as any).trailingStopBps ? parseFloat((pos as any).trailingStopBps.toString()) : 0;

    return (
        <div data-testid="position-card" className="p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]/70 shadow-lg">
            {/* Header: Market and PnL */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2.5 min-w-0">
                    {market && (
                        <div className="relative shrink-0">
                            <img src={market.image} className="w-8 h-8 rounded-full ring-2 ring-[var(--border-color)]" alt="" />
                            <div className={clsx(
                                "absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-secondary)]",
                                pos.isLong ? "bg-[var(--long)]" : "bg-[var(--short)]"
                            )} />
                        </div>
                    )}
                    <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="font-bold text-text-primary truncate leading-tight">{market?.symbol || 'Unknown'}</span>
                            {isOptimistic && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" title="Pending" />}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={clsx("text-[10px] font-bold uppercase tracking-wider", pos.isLong ? "text-[var(--long)]" : "text-[var(--short)]")}>
                                {pos.isLong ? 'Long' : 'Short'}
                            </span>
                            <span className="text-[10px] text-text-muted font-mono bg-[var(--bg-tertiary)] px-1 rounded">
                                {Number(pos.leverage || 10).toFixed(1)}x
                            </span>
                        </div>
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <div className={clsx("font-mono font-bold text-sm", isProfit ? "text-[var(--long)]" : "text-[var(--short)]")}>
                        {isProfit ? '+' : ''}{settings.showPnlPercent && Number(pos.collateral) > 0 
                            ? ((pnl / Number(pos.collateral)) * 100).toFixed(2) + '%'
                            : '$' + Math.abs(pnl).toFixed(2)}
                    </div>
                    {settings.showPnlPercent && Number(pos.collateral) > 0 && (
                        <div className="text-[10px] text-text-muted font-mono">
                            {isProfit ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                        </div>
                    )}
                </div>
            </div>

            {/* Stats: Improved Grid/Flex combo to prevent overlap */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 mb-5 px-0.5">
                {[
                    { label: 'Net Value', value: `$${netValue.toFixed(2)}`, valueClass: 'text-text-primary' },
                    { label: 'Collateral', value: `$${Number(pos.collateral || (pos as any).margin).toFixed(2)}`, valueClass: 'text-text-primary', onClick: isOptimistic ? undefined : () => setActiveCollateralPos(pos), hasIcon: !isOptimistic },
                    { label: 'Entry Price', value: fmtUsdPrice(Number(pos.entryPrice)), valueClass: 'text-text-secondary' },
                    { label: 'Mark Price', value: fmtUsdPrice(Number(pos.markPrice ?? pos.entryPrice)), valueClass: 'text-[var(--primary)]' },
                    { label: 'Liq. Price', value: fmtUsdPrice(Number(pos.liquidationPrice)), valueClass: 'text-orange-400', fullWidth: true },
                ].map((item) => (
                    <div key={item.label} className={clsx("flex flex-col gap-1", item.fullWidth && "col-span-2")}>
                        <span className="text-[10px] uppercase font-bold tracking-widest text-text-muted">{item.label}</span>
                        {item.onClick ? (
                            <button onClick={item.onClick} className={clsx("flex items-center gap-1 font-mono text-sm tabular-nums text-left", item.valueClass)}>
                                {item.value} {item.hasIcon && <Edit2 size={10} className="text-text-muted" />}
                            </button>
                        ) : (
                            <span className={clsx("font-mono text-sm tabular-nums truncate", item.valueClass)} title={item.value}>{item.value}</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Actions: Sturdy, clear buttons */}
            <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => {
                            setSlTpPosition({
                                id: Number(pos.id),
                                stopLossPrice: slPrice,
                                takeProfitPrice: tpPrice,
                                trailingStopBps: trBps,
                                symbol: market?.symbol || 'Position',
                                isLong: !!pos.isLong,
                            });
                            setSlTpStopLoss(slPrice > 0 ? formatPriceWithPrecision(slPrice) : '');
                            setSlTpTakeProfit(tpPrice > 0 ? formatPriceWithPrecision(tpPrice) : '');
                            setTrailingStop(trBps > 0 ? trBps.toString() : '');
                        }}
                        disabled={isOptimistic}
                        className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)]/50 text-text-primary text-xs font-bold hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
                    >
                        <Shield size={14} /> Triggers
                    </button>
                    <button
                        onClick={() => setActiveClosePos(pos)}
                        disabled={isOptimistic}
                        className="py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)]/50 hover:bg-rose-500/10 hover:text-rose-500 text-text-primary text-xs font-bold transition-colors disabled:opacity-50"
                    >
                        Close Position
                    </button>
                </div>
                <button
                    type="button"
                    onClick={() => setActiveTransferPos(pos)}
                    disabled={isOptimistic}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)]/50 text-text-primary text-xs font-bold hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
                >
                    <ArrowRightLeft size={14} /> Transfer Position
                </button>
            </div>
        </div>
    );
}

function MobileOrderCard({ order, markets, onCancel, cancelling }: any) {
    const market = markets.find((m: any) => m.marketAddress?.toLowerCase() === order.market?.toLowerCase());
    return (
        <div className="p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]/70">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    {market && <img src={market.image} className="w-5 h-5 rounded-full" alt="" />}
                    <span className="font-bold text-text-primary">{market?.symbol || 'Unknown'}</span>
                    <span className={clsx(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded",
                        order.orderType <= 1 ? "text-blue-400 bg-blue-500/10" : "text-amber-400 bg-amber-500/10"
                    )}>
                        {getOrderTypeLabel(order.orderType)}
                    </span>
                </div>
                <span className="text-[10px] font-mono text-text-muted">ID: #{order.orderId.toString()}</span>
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                    Pending Confirmation
                </span>
                <button
                    onClick={onCancel}
                    disabled={cancelling}
                    className="text-xs font-bold text-[var(--short)] hover:underline disabled:opacity-50"
                >
                    {cancelling ? 'Cancelling...' : 'Cancel Order'}
                </button>
            </div>
        </div>
    );
}

function MobileHistoryCard({ t }: any) {
    const isProfit = t.pnl && parseFloat(t.pnl) >= 0;
    return (
        <div className="p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]/70">
            <div className="flex items-start justify-between mb-2">
                <div>
                    <div className={clsx("font-bold text-sm", t.side === 'LONG' ? "text-[var(--long)]" : "text-[var(--short)]")}>
                        {t.side} {t.market}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">{t.type}</div>
                </div>
                <div className="text-right">
                    <div className={clsx("font-mono font-bold text-sm", isProfit ? "text-[var(--long)]" : "text-[var(--short)]")}>
                        {t.pnl ? (isProfit ? '+' : '') + parseFloat(t.pnl).toFixed(2) : '-'}
                    </div>
                    <div className="text-[10px] text-text-muted font-mono">
                        {new Date(t.timestamp).toLocaleTimeString()}
                    </div>
                </div>
            </div>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-[var(--border-color)]/30">
                <span className="text-xs text-text-secondary">Execute Price</span>
                <span className="text-sm font-mono text-text-primary">{fmtUsdPrice(parseFloat(t.price))}</span>
            </div>
        </div>
    );
}
