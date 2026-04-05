import { useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Medal } from 'lucide-react';
import { useLeaderboard } from '../hooks/useBackend';
import { Skeleton } from '../components/ui';
import clsx from 'clsx';
import { formatCompact } from '../utils/format';

export function LeaderboardPage() {
    const [timeframe, setTimeframe] = useState<'24h' | '7d' | 'all'>('all');
    const { entries, loading } = useLeaderboard(50, timeframe);

    const getRankIcon = (rank: number) => {
        if (rank === 1) return <Medal className="w-6 h-6 text-yellow-400" />;
        if (rank === 2) return <Medal className="w-6 h-6 text-gray-300" />;
        if (rank === 3) return <Medal className="w-6 h-6 text-orange-400" />;
        return <span className="font-mono font-bold text-text-muted">#{rank}</span>;
    };

    return (
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-6 text-center md:text-left">
                <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-text-primary mb-2 flex items-center gap-3 justify-center md:justify-start">
                        <Trophy className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10 text-yellow-400" />
                        Leaderboard
                    </h1>
                    <p className="text-text-secondary text-sm sm:text-lg">
                        Top performing traders ranked by PnL and Volume.
                    </p>
                </div>

                {/* Timeframe Toggle */}
                <div className="bg-[var(--bg-tertiary)] p-1 rounded-lg flex space-x-1">
                    {['24h', '7d', 'All Time'].map((tf) => {
                        const key = tf.toLowerCase().replace(' ', '') as any;
                        return (
                            <button
                                key={key}
                                onClick={() => setTimeframe(key)}
                                className={clsx(
                                    "px-4 py-2 rounded text-sm font-bold transition-all",
                                    timeframe === key
                                        ? "bg-[var(--bg-secondary)] text-text-primary shadow-sm"
                                        : "text-text-muted hover:text-text-secondary"
                                )}
                            >
                                {tf}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Top 3 Cards (Hidden on mobile, shown on md+) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 lg:mb-8">
                {entries.slice(0, 3).map((entry) => (
                    <motion.div
                        key={entry.rank}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={clsx(
                            "glass-panel p-4 sm:p-6 relative overflow-hidden border-t-4",
                            entry.rank === 1 ? "border-yellow-400/50 bg-yellow-400/5" :
                                entry.rank === 2 ? "border-gray-300/50 bg-gray-300/5" :
                                    "border-orange-400/50 bg-orange-400/5"
                        )}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2 rounded-lg bg-[var(--bg-primary)]">
                                {getRankIcon(entry.rank)}
                            </div>
                            <div className="bg-[var(--bg-tertiary)] px-2 py-1 rounded text-xs text-text-muted font-mono">
                                {entry.wallet}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-sm text-text-secondary">Net PnL</div>
                            <div className="text-xl sm:text-2xl font-bold font-mono text-[var(--long)]">
                                {parseFloat(entry.pnl) >= 0 ? '+' : ''}{formatCompact(parseFloat(entry.pnl))}
                            </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-[var(--border-color)] flex justify-between text-sm">
                            <span className="text-text-muted">Volume</span>
                            <span className="font-mono text-text-primary font-medium">{formatCompact(parseFloat(entry.volume))}</span>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Full Table */}
            <div className="glass-panel overflow-hidden">
                <div className="overflow-x-auto hidden md:block">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/30">
                                <th className="px-6 py-4 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Rank</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Trader</th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-text-secondary uppercase tracking-wider">Net PnL</th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-text-secondary uppercase tracking-wider">Volume</th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-text-secondary uppercase tracking-wider">Trades</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>
                                        <td className="px-6 py-4"><Skeleton className="h-6 w-8" /></td>
                                        <td className="px-6 py-4"><Skeleton className="h-6 w-32" /></td>
                                        <td className="px-6 py-4 text-right"><Skeleton className="h-6 w-24 ml-auto" /></td>
                                        <td className="px-6 py-4 text-right"><Skeleton className="h-6 w-24 ml-auto" /></td>
                                        <td className="px-6 py-4 text-right"><Skeleton className="h-6 w-12 ml-auto" /></td>
                                    </tr>
                                ))
                            ) : entries.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-text-muted">
                                        No data available for this timeframe.
                                    </td>
                                </tr>
                            ) : (
                                entries.map((entry) => (
                                    <tr key={entry.rank} className="group hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                {getRankIcon(entry.rank)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-500" />
                                                <span className="font-mono text-sm text-[var(--primary)] font-medium">{entry.wallet}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <span className={clsx(
                                                "font-mono font-bold",
                                                parseFloat(entry.pnl) >= 0 ? "text-[var(--long)]" : "text-[var(--short)]"
                                            )}>
                                                {parseFloat(entry.pnl) >= 0 ? '+' : ''}{formatCompact(parseFloat(entry.pnl))}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-sm text-text-primary">
                                            {formatCompact(parseFloat(entry.volume))}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-sm text-text-primary">
                                            {entry.trades}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile List View */}
                <div className="md:hidden divide-y divide-[var(--border-color)]">
                    {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="p-4">
                                <Skeleton className="h-12 w-full mb-2" />
                                <Skeleton className="h-4 w-2/3" />
                            </div>
                        ))
                    ) : entries.length === 0 ? (
                        <div className="p-8 text-center text-text-muted">
                            No data available.
                        </div>
                    ) : (
                        entries.map((entry) => (
                            <div key={entry.rank} className="p-4 bg-[var(--bg-secondary)]">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 flex items-center justify-center">
                                            {getRankIcon(entry.rank)}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-500" />
                                            <span className="font-mono text-sm text-[var(--primary)] font-bold">{entry.wallet}</span>
                                        </div>
                                    </div>
                                    <div className={clsx(
                                        "font-mono font-bold text-lg",
                                        parseFloat(entry.pnl) >= 0 ? "text-[var(--long)]" : "text-[var(--short)]"
                                    )}>
                                        {parseFloat(entry.pnl) >= 0 ? '+' : ''}{formatCompact(parseFloat(entry.pnl))}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-sm text-text-secondary pl-11">
                                    <div className="flex gap-4">
                                        <span>
                                            Vol: <span className="text-text-primary font-mono">{formatCompact(parseFloat(entry.volume))}</span>
                                        </span>
                                        <span>
                                            Trades: <span className="text-text-primary font-mono">{entry.trades}</span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
