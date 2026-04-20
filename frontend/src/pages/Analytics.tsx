import { ReactNode, useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, BarChart2, Activity, Loader2, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import {
    Bar,
    BarChart,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    CartesianGrid
} from 'recharts';
import { useVaultStats } from '../hooks/useVault';
import { useBackendStats, useLeaderboard, useDailyStats, useMarkets, LeaderboardEntry } from '../hooks/useBackend';
import { Skeleton } from '../components/ui';
import { formatCompact } from '../utils/format';
import { useAllMarketsOnChainData } from '../hooks/useMarketData';
import { useMarketsStore } from '../stores';
import { Address } from 'viem';

interface DailyStats {
    date: string;
    volume: number;
    trades: number;
    positionsOpened: number;
    positionsClosed: number;
    fees: number;
    pnl: number;
    uniqueTraders: number;
}

interface StatCardProps {
    title: string;
    value: string | number;
    change?: number;
    icon: ReactNode;
    className?: string;
    loading?: boolean;
}

function formatUsdStat(value: unknown): string {
    const n =
        typeof value === 'number'
            ? value
            : typeof value === 'string'
              ? parseFloat(value.trim())
              : Number(value);
    if (!Number.isFinite(n)) return formatCompact(0);
    return formatCompact(n);
}

function StatCard({ title, value, change, icon, className = '', loading }: StatCardProps) {
    return (
        <div className={clsx('glass-card min-w-0 overflow-hidden p-4 md:p-6 flex flex-col justify-between h-[110px] md:h-[130px] hover:bg-[var(--bg-tertiary)]/20 transition-colors', className)}>
            <div className="flex items-start justify-between gap-2 min-w-0">
                <span className="text-text-secondary text-xs md:text-sm font-medium uppercase tracking-wider truncate leading-tight mt-1">{title}</span>
                <div className="text-[var(--primary)] p-1.5 md:p-2 bg-[var(--primary)]/10 rounded-lg shrink-0">{icon}</div>
            </div>
            <div
                className="text-lg sm:text-xl md:text-2xl font-bold text-text-primary font-mono tracking-tight min-w-0 break-words [overflow-wrap:anywhere] leading-tight"
                title={!loading ? String(value) : undefined}
            >
                {loading ? <Skeleton className="h-8 w-24" /> : value}
            </div>
            {change !== undefined && !loading && (
                <div className={clsx('flex items-center text-sm mt-1 font-medium', change >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {change >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                    {Math.abs(change).toFixed(2)}%
                </div>
            )}
        </div>
    );
}

type TooltipPayloadItem = { name?: string; value?: number; color?: string;[key: string]: unknown };
const CustomTooltip = ({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
    label?: string;
}) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] p-3 rounded-lg shadow-xl text-xs">
                <p className="text-text-secondary mb-1 font-medium">{label}</p>
                {payload.map((entry: TooltipPayloadItem, index: number) => (
                    <p key={index} style={{ color: entry.color }} className="font-mono">
                        {entry.name}: {(entry.value ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

function VolumeChart({ data }: { data: DailyStats[] }) {
    if (data.length === 0) return null;

    const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return (
        <div className="glass-panel p-4 md:p-6 h-full flex flex-col">
            <h3 className="text-lg font-bold text-text-primary mb-6 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-[var(--primary)]" />
                Volume History
            </h3>
            <div className="flex-1 min-h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sortedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" opacity={0.3} />
                        <XAxis
                            dataKey="date"
                            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(str) => {
                                const date = new Date(str);
                                return `${date.getMonth() + 1}/${date.getDate()}`;
                            }}
                        />
                        <YAxis
                            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => `$${(val / 1000000).toFixed(0)}M`}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-tertiary)', opacity: 0.4 }} />
                        <Bar
                            dataKey="volume"
                            name="Volume"
                            fill="url(#volumeGradient)"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={50}
                        />
                        <defs>
                            <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.3} />
                            </linearGradient>
                        </defs>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function OpenInterestChart({ longOI, shortOI }: { longOI: number; shortOI: number }) {
    const data = [
        { name: 'Long', value: longOI, color: 'var(--long)' },
        { name: 'Short', value: shortOI, color: 'var(--short)' },
    ];

    const total = longOI + shortOI;

    return (
        <div className="glass-panel p-4 md:p-6 h-full flex flex-col">
            <h3 className="text-lg font-bold text-text-primary mb-6 flex items-center gap-2">
                <Activity className="w-5 h-5 text-[var(--primary)]" />
                OI Composition
            </h3>
            <div className="flex-1 min-h-[300px] relative">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                </ResponsiveContainer>

                {/* Center Stats */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs text-text-secondary font-medium uppercase tracking-wider">Total OI</span>
                    <span className="text-lg font-bold text-text-primary font-mono">${(total / 1000).toFixed(1)}K</span>
                </div>
            </div>

            <div className="mt-4 space-y-3">
                <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-[var(--bg-tertiary)]/30 border border-[var(--border-color)]">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-400" />
                        <span className="text-text-secondary">Longs</span>
                    </div>
                    <span className="font-mono font-bold text-text-primary">${(longOI / 1000).toFixed(2)}K</span>
                </div>
                <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-[var(--bg-tertiary)]/30 border border-[var(--border-color)]">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-rose-400" />
                        <span className="text-text-secondary">Shorts</span>
                    </div>
                    <span className="font-mono font-bold text-text-primary">${(shortOI / 1000).toFixed(2)}K</span>
                </div>
            </div>
        </div>
    );
}

function Leaderboard({ entries, loading, error }: { entries: LeaderboardEntry[]; loading: boolean; error: string | null }) {
    return (
        <div className="glass-panel overflow-hidden h-full flex flex-col">
            <div className="p-4 md:p-6 border-b border-[var(--border-color)]">
                <h3 className="text-lg font-bold text-text-primary">Top Traders</h3>
            </div>
            {error && (
                <div className="p-4 flex items-center gap-2 text-sm text-rose-400 bg-rose-500/10 m-4 rounded">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* Desktop Table View */}
            <div className="overflow-x-auto flex-1 min-h-[300px] hidden md:block">
                {loading && entries.length === 0 ? (
                    <div className="flex justify-center items-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex justify-center items-center h-full text-text-muted text-sm px-4 text-center">
                        No leaderboard data available yet. start trading to appear here!
                    </div>
                ) : (
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
                            <tr className="text-xs text-text-secondary uppercase tracking-wider border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30">
                                <th className="p-4 font-medium w-16 text-center">Rank</th>
                                <th className="p-4 font-medium">Trader</th>
                                <th className="p-4 font-medium text-right">PnL</th>
                                <th className="p-4 font-medium text-right">Volume</th>
                                <th className="p-4 font-medium text-right">Trades</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {entries.map((entry) => (
                                <tr key={entry.rank} className="hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                                    <td className="p-4 text-center">
                                        <span className={clsx(
                                            "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
                                            entry.rank === 1 ? "bg-yellow-500/20 text-yellow-500" :
                                                entry.rank === 2 ? "bg-[var(--bg-tertiary)] text-text-muted" :
                                                    entry.rank === 3 ? "bg-orange-500/20 text-orange-500" :
                                                        "text-text-muted"
                                        )}>
                                            {entry.rank}
                                        </span>
                                    </td>
                                    <td className="p-4 font-mono text-text-primary">
                                        {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                                    </td>
                                    <td className={clsx("p-4 text-right font-mono font-medium", parseFloat(entry.pnl) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                        {parseFloat(entry.pnl) >= 0 ? '+' : ''}${parseFloat(entry.pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </td>
                                    <td className="p-4 text-right font-mono text-text-secondary">
                                        ${(parseFloat(entry.volume) / 1000).toFixed(0)}K
                                    </td>
                                    <td className="p-4 text-right font-mono text-text-muted">
                                        {entry.trades}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-[var(--border-color)] overflow-y-auto max-h-[500px]">
                {loading && entries.length === 0 ? (
                    <div className="flex justify-center items-center h-32">
                        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex justify-center items-center h-32 text-text-muted text-sm px-4 text-center">
                        No leaderboard data.
                    </div>
                ) : (
                    entries.map((entry) => (
                        <div key={entry.rank} className="p-4 hover:bg-[var(--bg-tertiary)]/20">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className={clsx(
                                        "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold",
                                        entry.rank === 1 ? "bg-yellow-500/20 text-yellow-500" :
                                            entry.rank === 2 ? "bg-[var(--bg-tertiary)] text-text-muted" :
                                                entry.rank === 3 ? "bg-orange-500/20 text-orange-500" :
                                                    "bg-[var(--bg-tertiary)] text-text-muted"
                                    )}>
                                        {entry.rank}
                                    </span>
                                    <span className="font-mono text-sm font-medium text-text-primary">
                                        {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                                    </span>
                                </div>
                                <div className={clsx("font-mono font-bold text-sm", parseFloat(entry.pnl) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {parseFloat(entry.pnl) >= 0 ? '+' : ''}${parseFloat(entry.pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            </div>
                            <div className="flex justify-between text-xs text-text-secondary">
                                <span>Vol: ${(parseFloat(entry.volume) / 1000).toFixed(0)}K</span>
                                <span>Trades: {entry.trades}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}


export default function AnalyticsDashboard() {
    const { stats: vaultStats, loading: vaultLoading } = useVaultStats();
    const { markets: apiMarkets, loading: marketsLoading } = useMarkets();
    const { stats: backendStats, loading: statsLoading, error: statsError } = useBackendStats();
    const { entries: leaderboardEntries, loading: leaderboardLoading, error: leaderboardError } = useLeaderboard(10);
    const { stats: dailyStats, loading: historyLoading, error: historyError } = useDailyStats();

    const marketAddresses = useMemo(() =>
        apiMarkets.map(m => m.marketAddress as Address).filter(addr => !!addr && addr !== '0x...' && addr !== '0x0000000000000000000000000000000000000000')
    , [apiMarkets]);

    const { data: onChainData } = useAllMarketsOnChainData(marketAddresses);



    const formattedHistory: DailyStats[] = dailyStats.map(d => ({
        date: d.date,
        volume: parseFloat(d.volume),
        trades: d.trades,
        positionsOpened: 0,
        positionsClosed: 0,
        fees: parseFloat(d.fees),
        pnl: parseFloat(d.pnl),
        uniqueTraders: 0
    }));

    const totalVolume = backendStats ? parseFloat(backendStats.volume24h) : 0;
    const activeTraders24h = backendStats?.activeTraders24h ?? 0;

    const { realTimeLongOI, realTimeShortOI, realTimeOI } = useMemo(() => {
        const onChainTotalLong = Object.values(onChainData).reduce((acc, val) => acc + val.longOI, 0);
        const onChainTotalShort = Object.values(onChainData).reduce((acc, val) => acc + val.shortOI, 0);
        const total = onChainTotalLong + onChainTotalShort;

        if (total > 0) {
            return { realTimeLongOI: onChainTotalLong, realTimeShortOI: onChainTotalShort, realTimeOI: total };
        }

        const apiLong = apiMarkets.reduce((acc, m) => acc + parseFloat(m.longOI), 0);
        const apiShort = apiMarkets.reduce((acc, m) => acc + parseFloat(m.shortOI), 0);
        return { realTimeLongOI: apiLong, realTimeShortOI: apiShort, realTimeOI: apiLong + apiShort };
    }, [onChainData, apiMarkets]);

    return (
        <div className="min-h-screen pb-20 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-text-primary tracking-tight">Analytics Dashboard</h1>
                    <p className="text-text-secondary mt-1 text-sm md:text-lg">Real-time protocol statistics and volume history.</p>
                </div>

            </div>

            {/* API Errors */}
            {(statsError || historyError) && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex items-center gap-3 text-sm text-rose-400">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                        <p className="font-bold">Error fetching data</p>
                        <p>{statsError || historyError}</p>
                    </div>
                </div>
            )}

            {/* Top Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Total Value Locked"
                    value={formatUsdStat((() => {
                        const vTvl = vaultStats?.tvl ?? 0;
                        const bTvl = parseFloat(backendStats?.tvl ?? '0');
                        return vTvl > 0 ? vTvl : bTvl;
                    })())}
                    icon={<Activity className="w-5 h-5 md:w-6 md:h-6" />}
                    loading={!vaultStats?.tvl && vaultLoading && statsLoading}
                />
                <StatCard
                    title="Open Interest"
                    value={formatUsdStat(realTimeOI)}
                    icon={<Activity className="w-5 h-5 md:w-6 md:h-6" />}
                    loading={marketsLoading}
                />
                <StatCard
                    title="Total Volume (24h)"
                    value={formatUsdStat(totalVolume)}
                    icon={<DollarSign className="w-5 h-5 md:w-6 md:h-6" />}
                    loading={statsLoading}
                />
                <StatCard
                    title="Active Traders"
                    value={activeTraders24h}
                    icon={<BarChart2 className="w-5 h-5 md:w-6 md:h-6" />}
                    loading={statsLoading}
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                {/* Left Column: Charts */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Volume Chart */}
                    <div className="h-[400px]">
                        {historyLoading && formattedHistory.length === 0 ? (
                            <div className="glass-panel p-6 flex flex-col items-center justify-center h-full">
                                <Loader2 className="w-8 h-8 animate-spin text-text-muted mb-2" />
                                <span className="text-text-muted">Loading chart data...</span>
                            </div>
                        ) : formattedHistory.length > 0 ? (
                            <VolumeChart data={formattedHistory} />
                        ) : (
                            <div className="glass-panel p-6 flex flex-col items-center justify-center h-full text-text-muted">
                                No historical volume data available
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: OI & Leaderboard */}
                <div className="space-y-6 flex flex-col">
                    {/* Open Interest Chart */}
                    <div className="min-h-[450px]">
                        <OpenInterestChart
                            longOI={realTimeLongOI}
                            shortOI={realTimeShortOI}
                        />
                    </div>

                    {/* Leaderboard */}
                    <div className="flex-1 min-h-[400px]">
                        <Leaderboard
                            entries={leaderboardEntries}
                            loading={leaderboardLoading}
                            error={leaderboardError}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
