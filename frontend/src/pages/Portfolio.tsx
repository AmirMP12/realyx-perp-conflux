import { useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import {
    Wallet, TrendingUp, TrendingDown, DollarSign,
    History, BarChart2
} from 'lucide-react';
import clsx from 'clsx';
import {
    Area,
    AreaChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    CartesianGrid,
} from 'recharts';
import { format } from 'date-fns';
import { usePositions } from '../hooks/usePositions';
import { useLivePnL } from '../hooks/useWebSocket';
import { useTradeHistory, type TradeHistoryItem } from '../hooks/useBackend';
import { useMarketsStore } from '../stores';
import { formatCompact } from '../utils/format';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { PositionTable } from '../components/trading/PositionTable';
import { Skeleton } from '../components/ui';

export function PortfolioPage() {
    const { address } = useAccount();
    const isConnected = !!address;

    const { positions, closedPositions, isLoading: positionsLoading, refetch: fetchPositions } = usePositions();
    const markets = useMarketsStore((s) => s.markets);
    const positionsWithLivePnL = useLivePnL(positions, markets);

    const { trades: tradeHistoryRaw, loading: historyLoading, refetch: refetchHistory } = useTradeHistory(50);

    const tradeHistory = useMemo(() => {
        const closedAsTrades = closedPositions.map(p => {
            const m = markets.find(m => m.marketAddress.toLowerCase() === p.marketAddress.toLowerCase());
            return {
                id: Number(p.id),
                signature: `closed-${p.id}`,
                market: m?.symbol || p.marketAddress,
                side: p.isLong ? 'LONG' : 'SHORT' as 'LONG' | 'SHORT',
                size: p.size,
                price: p.entryPrice,
                leverage: Number(p.leverage),
                fee: '0',
                pnl: p.pnl,
                type: 'CLOSE' as const,
                timestamp: p.openTimestamp ? new Date((p.openTimestamp as number) * 1000).toISOString() : new Date().toISOString()
            };
        });
        const merged = [...closedAsTrades, ...tradeHistoryRaw];
        const seen = new Set();
        const deduplicated = merged.filter(t => {
            if (seen.has(t.signature)) return false;
            seen.add(t.signature);
            return true;
        });
        return deduplicated.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [closedPositions, tradeHistoryRaw, markets]);
    useEffect(() => {
        if (!isConnected) return;

        const interval = setInterval(() => {
            refetchHistory();
        }, 15000); // Poll history every 15s

        return () => clearInterval(interval);
    }, [isConnected, refetchHistory]);
    const totalPnl = positionsWithLivePnL.reduce((sum, p) => sum + ((p as any).livePnl ?? parseFloat(p.pnl || '0')), 0);

    const pnlChartData = useMemo(() => {
        const closed = tradeHistory.filter((t: TradeHistoryItem) => t.type === 'CLOSE' && t.pnl != null);
        closed.sort((a: TradeHistoryItem, b: TradeHistoryItem) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        let cum = 0;
        return closed.map((t: TradeHistoryItem) => {
            cum += parseFloat(t.pnl || '0');
            return {
                date: format(new Date(t.timestamp), 'MMM d'),
                pnl: cum,
                raw: parseFloat(t.pnl || '0'),
            };
        });
    }, [tradeHistory]);
    const totalCollateral = positions.reduce((sum, p) => sum + parseFloat(p.collateral || '0'), 0);
    const accountValue = totalCollateral + totalPnl;
    const activePositionsCount = positions.length;

    if (!isConnected) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] p-6">
                <div className="glass-panel p-12 text-center max-w-md w-full">
                    <Wallet className="w-20 h-20 text-text-muted mx-auto mb-6 opacity-50" />
                    <h2 className="text-3xl font-bold text-text-primary mb-3">Connect Your Wallet</h2>
                    <p className="text-text-secondary mb-8">View and manage your perpetual positions</p>
                    <div className="flex justify-center">
                        <ConnectButton />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 min-w-0">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-text-primary mb-2">Portfolio</h1>
                    <p className="text-text-secondary">Overview of your account performance and active positions.</p>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {positionsLoading ? (
                    <>
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="glass-panel p-5">
                                <Skeleton className="h-4 w-24 mb-3" />
                                <Skeleton className="h-8 w-32 mb-2" />
                                <Skeleton className="h-3 w-full" />
                            </div>
                        ))}
                    </>
                ) : (
                    <>
                        <StatCard
                            icon={DollarSign}
                            label="Account Value"
                            value={formatCompact(accountValue)}
                            sublabel="Collateral + Unrealized PnL"
                        />
                        <StatCard
                            icon={Wallet}
                            label="Total Collateral"
                            value={formatCompact(totalCollateral)}
                            sublabel="Locked in positions"
                        />
                        <StatCard
                            icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
                            label="Unrealized PnL"
                            value={`${totalPnl >= 0 ? '+' : ''}${formatCompact(totalPnl)}`}
                            sublabel={`${totalCollateral > 0 ? ((totalPnl / totalCollateral) * 100).toFixed(2) : '0.00'}% Return`}
                            valueColor={totalPnl >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]'}
                        />
                        <StatCard
                            icon={History}
                            label="Active Positions"
                            value={activePositionsCount.toString()}
                            sublabel={`${tradeHistory.length} historical trades`}
                        />
                    </>
                )}
            </div>

            {/* Cumulative PnL Chart */}
            {pnlChartData.length > 0 && (
                <div className="glass-panel p-6" aria-label="Cumulative PnL over time">
                    <h2 className="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
                        <BarChart2 className="w-5 h-5 text-[var(--primary)]" />
                        Cumulative PnL
                    </h2>
                    <div className="h-[200px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={pnlChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
                                <Tooltip
                                    contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                                    labelStyle={{ color: 'var(--text-primary)' }}
                                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative PnL']}
                                    labelFormatter={(label) => label}
                                />
                                <Area type="monotone" dataKey="pnl" stroke="var(--primary)" fill="url(#pnlGradient)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div className="glass-panel min-h-[400px] flex flex-col overflow-hidden">
                <PositionTable
                    positions={positionsWithLivePnL}
                    positionsLoading={positionsLoading}
                    tradeHistory={tradeHistory}
                    historyLoading={historyLoading}
                    markets={markets}
                    fetchPositions={fetchPositions}
                />
            </div>
        </div >
    );
}

function StatCard({ icon: Icon, label, value, sublabel, valueColor }: any) {
    return (
        <div className="glass-panel p-4 sm:p-5 flex flex-col justify-between h-full hover:bg-[var(--bg-tertiary)]/20 transition-colors min-w-0">
            <div className="flex items-center justify-between mb-2">
                <span className="text-text-muted text-xs uppercase tracking-wider font-medium">{label}</span>
                <Icon className="w-4 h-4 text-text-muted" />
            </div>
            <div>
                <div className={clsx('text-xl sm:text-2xl font-bold font-mono tracking-tight truncate', valueColor || 'text-text-primary')}>{value}</div>
                <div className="text-xs text-text-secondary mt-1">{sublabel}</div>
            </div>
        </div>
    );
}
