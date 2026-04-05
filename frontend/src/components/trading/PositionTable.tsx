import { useState } from 'react';
import { X, Edit2, Shield, Wallet, Clock, FileText } from 'lucide-react';
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
import { Skeleton } from '../ui/Skeleton';

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

    const [slTpPosition, setSlTpPosition] = useState<{ id: number; stopLossPrice: number; takeProfitPrice: number; trailingStopBps: number } | null>(null);
    const [activeCollateralPos, setActiveCollateralPos] = useState<Position | null>(null);
    const [activeClosePos, setActiveClosePos] = useState<Position | null>(null);

    const { orders: pendingOrders, loading: ordersLoading, refetch: refetchOrders } = usePendingOrders();

    const [slTpStopLoss, setSlTpStopLoss] = useState('');
    const [slTpTakeProfit, setSlTpTakeProfit] = useState('');
    const [trailingStop, setTrailingStop] = useState('');

    const { setStopLoss, loading: slLoading } = useSetStopLoss();
    const { setTakeProfit, loading: tpLoading } = useSetTakeProfit();
    const { setTrailingStop: setTrailing, loading: trLoading } = useSetTrailingStop();
    const { cancelOrder, loading: cancellingOrder } = useCancelOrder();

    const confirmSlTp = async () => {
        if (!slTpPosition) return;
        const sl = slTpStopLoss.trim() ? parseFloat(slTpStopLoss) : 0;
        const tp = slTpTakeProfit.trim() ? parseFloat(slTpTakeProfit) : 0;
        const tr = trailingStop.trim() ? parseFloat(trailingStop) : 0; // bps

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
                            <div className="hidden md:block">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="text-xs text-text-muted uppercase tracking-wider bg-[var(--bg-tertiary)]/30 sticky top-0 z-10">
                                        <tr>
                                            <th className="px-4 py-2 font-medium">Market</th>
                                            <th className="px-4 py-2 font-medium text-right">Net Value</th>
                                            <th className="px-4 py-2 font-medium text-right">Size</th>
                                            <th className="px-4 py-2 font-medium text-right">Collateral</th>
                                            <th className="px-4 py-2 font-medium text-right">Entry Price</th>
                                            <th className="px-4 py-2 font-medium text-right">Mark Price</th>
                                            <th className="px-4 py-2 font-medium text-right">Liq. Price</th>
                                            <th className="px-4 py-2 font-medium text-right">PnL</th>
                                            <th className="px-4 py-2 font-medium text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border-color)]">
                                        {positions.map((pos: any, i: number) => (
                                            <PositionRow
                                                key={i}
                                                pos={pos}
                                                markets={markets}
                                                settings={settings}
                                                cellPad={cellPad}
                                                setActiveCollateralPos={setActiveCollateralPos}
                                                setActiveClosePos={setActiveClosePos}
                                                setSlTpPosition={setSlTpPosition}
                                                setSlTpStopLoss={setSlTpStopLoss}
                                                setSlTpTakeProfit={setSlTpTakeProfit}
                                                setTrailingStop={setTrailingStop}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile List */}
                            <div className="md:hidden px-3 pb-3 space-y-3">
                                {positions.map((pos: any, i: number) => (
                                    <MobilePositionCard
                                        key={i}
                                        pos={pos}
                                        markets={markets}
                                        setActiveCollateralPos={setActiveCollateralPos}
                                        setActiveClosePos={setActiveClosePos}
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
                        <div className="overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
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
                        <div className="overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
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
                                            <td className="px-4 py-3 text-right font-mono text-text-primary">
                                                ${parseFloat(t.price).toFixed(2)}
                                            </td>
                                            <td className={clsx("px-4 py-3 text-right font-mono", t.pnl && parseFloat(t.pnl) >= 0 ? "text-[var(--long)]" : "text-[var(--short)]")}>
                                                {t.pnl ? (parseFloat(t.pnl) >= 0 ? '+' : '') + parseFloat(t.pnl).toFixed(2) : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                )}
            </div>

            {/* Triggers Modal */}
            <AnimatePresence>
                {slTpPosition && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-6 max-w-sm w-full shadow-2xl relative"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-text-primary">Position Triggers</h2>
                                <button onClick={() => setSlTpPosition(null)} className="text-text-muted hover:text-text-primary">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-4 mb-6">
                                <div>
                                    <label className="text-xs text-text-secondary block mb-1.5 uppercase font-bold">Stop Loss</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="any"
                                            value={slTpStopLoss}
                                            onChange={e => setSlTpStopLoss(e.target.value)}
                                            placeholder="Price (USD)"
                                            className="w-full bg-[var(--bg-tertiary)] border border-transparent focus:border-[var(--primary)] rounded px-3 py-2 font-mono text-text-primary outline-none transition-colors"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">USD</div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-text-secondary block mb-1.5 uppercase font-bold">Take Profit</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="any"
                                            value={slTpTakeProfit}
                                            onChange={e => setSlTpTakeProfit(e.target.value)}
                                            placeholder="Price (USD)"
                                            className="w-full bg-[var(--bg-tertiary)] border border-transparent focus:border-[var(--primary)] rounded px-3 py-2 font-mono text-text-primary outline-none transition-colors"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">USD</div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-text-secondary block mb-1.5 uppercase font-bold">Trailing Stop</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="10"
                                            value={trailingStop}
                                            onChange={e => setTrailingStop(e.target.value)}
                                            placeholder="Basis Points (e.g. 100 = 1%)"
                                            className="w-full bg-[var(--bg-tertiary)] border border-transparent focus:border-[var(--primary)] rounded px-3 py-2 font-mono text-text-primary outline-none transition-colors"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">BPS</div>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-1">100 BPS = 1%. 0 to disable.</div>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={confirmSlTp}
                                disabled={slLoading || tpLoading || trLoading}
                                className="w-full py-3 bg-[var(--primary)] rounded font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
                            >
                                {slLoading || tpLoading || trLoading ? 'Updating...' : 'Confirm'}
                            </button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <CollateralEditModal
                isOpen={!!activeCollateralPos}
                onClose={() => { setActiveCollateralPos(null); setTimeout(fetchPositions, 1000); }}
                position={activeCollateralPos}
            />

            <ClosePositionModal
                isOpen={!!activeClosePos}
                onClose={() => { setActiveClosePos(null); setTimeout(fetchPositions, 1000); }}
                position={activeClosePos}
            />
        </div>
    );
}

function PositionRow({ pos, markets, settings, cellPad, setActiveCollateralPos, setActiveClosePos, setSlTpPosition, setSlTpStopLoss, setSlTpTakeProfit, setTrailingStop }: any) {
    const market = markets.find((m: any) => (m.marketAddress || '').toLowerCase() === (pos.marketAddress || '').toLowerCase());
    const pnl = Number(pos.livePnl ?? pos.pnl);
    const isProfit = pnl >= 0;
    const isOptimistic = (pos as any).isOptimistic || String(pos.id).startsWith('opt-');

    const slPrice = pos.stopLossPrice ? parseFloat(pos.stopLossPrice.toString()) : 0;
    const tpPrice = pos.takeProfitPrice ? parseFloat(pos.takeProfitPrice.toString()) : 0;
    const trBps = (pos as any).trailingStopBps ? parseFloat((pos as any).trailingStopBps.toString()) : 0;

    return (
        <tr className="hover:bg-[var(--bg-tertiary)]/40 transition-colors duration-150">
            <td className="px-4 py-3 font-medium text-text-primary">
                <div className="flex items-center gap-2">
                    {market && <img src={market.image} className="w-5 h-5 rounded-full" alt="" />}
                    <span>{market?.symbol || 'Unknown'}</span>
                    <span className={clsx("text-xs font-bold px-1.5 py-0.5 rounded ml-1", pos.isLong ? "text-[var(--long)] bg-[var(--long)]/10" : "text-[var(--short)] bg-[var(--short)]/10")}>
                        {pos.isLong ? 'Long' : 'Short'}
                    </span>
                    {isOptimistic && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 animate-pulse">Pending</span>
                    )}
                </div>
            </td>
            <td className="px-4 py-3 text-right font-mono text-text-primary">
                ${Number(pos.size).toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-mono text-text-primary">
                {(Number(pos.size) / (Number(pos.entryPrice) || 1)).toFixed(4)} {market?.symbol}
            </td>
            <td className="px-4 py-3 text-right font-mono text-text-primary">
                <div className="flex items-center justify-end gap-2 group">
                    ${Number(pos.collateral || (pos as any).margin).toFixed(2)}
                    {!isOptimistic && (
                        <button
                            onClick={() => setActiveCollateralPos(pos)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--bg-tertiary)] rounded text-gray-400 hover:text-white transition-all"
                            title="Edit Collateral"
                        >
                            <Edit2 size={12} />
                        </button>
                    )}
                </div>
            </td>
            <td className="px-4 py-3 text-right font-mono text-text-primary">
                ${Number(pos.entryPrice).toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-mono text-text-primary">
                ${Number(pos.markPrice ?? pos.entryPrice).toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-mono text-orange-400">
                ${Number(pos.liquidationPrice).toFixed(2)}
            </td>
            <td className={clsx(cellPad, "text-right font-mono", isProfit ? "text-[var(--long)]" : "text-[var(--short)]")}>
                {isProfit ? '+' : ''}{pnl.toFixed(2)}
                {settings.showPnlPercent && Number(pos.collateral) > 0 && (
                    <span className="text-[10px] ml-1 opacity-70">
                        ({isProfit ? '+' : ''}{((pnl / Number(pos.collateral)) * 100).toFixed(1)}%)
                    </span>
                )}
            </td>
            <td className="px-4 py-3 text-right">
                {isOptimistic ? (
                    <span className="text-xs text-text-muted">Confirming...</span>
                ) : (
                    <div className="flex items-center justify-end gap-2">
                        <button
                            onClick={() => {
                                setSlTpPosition({
                                    id: Number(pos.id),
                                    stopLossPrice: slPrice,
                                    takeProfitPrice: tpPrice,
                                    trailingStopBps: trBps
                                });
                                setSlTpStopLoss(slPrice > 0 ? slPrice.toFixed(2) : '');
                                setSlTpTakeProfit(tpPrice > 0 ? tpPrice.toFixed(2) : '');
                                setTrailingStop(trBps > 0 ? trBps.toString() : '');
                            }}
                            className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-text-secondary hover:text-text-primary transition-colors"
                            title="Edit Trigger Orders"
                        >
                            <Shield className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setActiveClosePos(pos)}
                            className="px-3 py-1 text-xs font-bold bg-[var(--bg-tertiary)] hover:bg-white/10 text-white rounded transition-colors"
                        >
                            Close
                        </button>
                    </div>
                )}
            </td>
        </tr>
    );
}

function MobilePositionCard({ pos, markets, setActiveCollateralPos, setActiveClosePos, setSlTpPosition, setSlTpStopLoss, setSlTpTakeProfit, setTrailingStop }: any) {
    const market = markets.find((m: any) => (m.marketAddress || '').toLowerCase() === (pos.marketAddress || '').toLowerCase());
    const pnl = Number(pos.livePnl ?? pos.pnl);
    const isProfit = pnl >= 0;
    const netValue = Number(pos.size);
    const isOptimistic = (pos as any).isOptimistic || String(pos.id).startsWith('opt-');

    const slPrice = pos.stopLossPrice ? parseFloat(pos.stopLossPrice.toString()) : 0;
    const tpPrice = pos.takeProfitPrice ? parseFloat(pos.takeProfitPrice.toString()) : 0;
    const trBps = (pos as any).trailingStopBps ? parseFloat((pos as any).trailingStopBps.toString()) : 0;

    return (
        <div className="p-4 bg-[var(--bg-tertiary)]/50 rounded-xl border border-[var(--border-color)]/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    {market && <img src={market.image} className="w-6 h-6 rounded-full" alt="" />}
                    <span className="font-bold text-text-primary">{market?.symbol || 'Unknown'}</span>
                    <span className={clsx("text-xs font-bold px-1.5 py-0.5 rounded ml-1", pos.isLong ? "text-[var(--long)] bg-[var(--long)]/10" : "text-[var(--short)] bg-[var(--short)]/10")}>
                        {pos.isLong ? 'Long' : 'Short'}
                    </span>
                    <span className="text-xs text-text-muted">x{Number(pos.leverage || 10).toFixed(1)}</span>
                    {isOptimistic && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 animate-pulse">Pending</span>}
                </div>
                <div className={clsx("font-mono font-bold", isProfit ? "text-[var(--long)]" : "text-[var(--short)]")}>
                    {isProfit ? '+' : ''}{pnl.toFixed(2)}
                </div>
            </div>

            {/* Grid Stats */}
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm mb-4">
                <div className="flex justify-between">
                    <span className="text-text-secondary">Net Value</span>
                    <span className="text-text-primary font-mono">${netValue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-text-secondary">Collateral</span>
                    {isOptimistic ? (
                        <span className="text-text-primary font-mono">${Number(pos.collateral || (pos as any).margin).toFixed(2)}</span>
                    ) : (
                        <button onClick={() => setActiveCollateralPos(pos)} className="flex items-center gap-1 text-text-primary font-mono underline decoration-dashed decoration-text-muted/50">
                            ${Number(pos.collateral || (pos as any).margin).toFixed(2)} <Edit2 size={10} className="text-text-muted" />
                        </button>
                    )}
                </div>
                <div className="flex justify-between">
                    <span className="text-text-secondary">Entry Price</span>
                    <span className="text-text-primary font-mono">${Number(pos.entryPrice).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-text-secondary">Mark Price</span>
                    <span className="text-text-primary font-mono">${Number(pos.markPrice ?? pos.entryPrice).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-text-secondary">Liq. Price</span>
                    <span className="text-orange-400 font-mono">${Number(pos.liquidationPrice).toFixed(2)}</span>
                </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
                {isOptimistic ? (
                    <div className="col-span-2 py-2 text-center text-xs text-text-muted">Confirming...</div>
                ) : (
                    <>
                        <button
                            onClick={() => {
                                setSlTpPosition({
                                    id: Number(pos.id),
                                    stopLossPrice: slPrice,
                                    takeProfitPrice: tpPrice,
                                    trailingStopBps: trBps
                                });
                                setSlTpStopLoss(slPrice > 0 ? slPrice.toFixed(2) : '');
                                setSlTpTakeProfit(tpPrice > 0 ? tpPrice.toFixed(2) : '');
                                setTrailingStop(trBps > 0 ? trBps.toString() : '');
                            }}
                            className="flex items-center justify-center gap-2 py-2 rounded bg-[var(--bg-tertiary)] text-text-primary font-medium hover:bg-[var(--border-color)] transition-colors"
                        >
                            <Shield size={14} /> Triggers
                        </button>
                        <button
                            onClick={() => setActiveClosePos(pos)}
                            className="py-2 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--primary)] text-text-primary hover:text-white font-medium transition-colors"
                        >
                            Close Position
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
