import { useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Medal } from 'lucide-react';
import { useLeaderboard, type LeaderboardTimeframe } from '../hooks/useBackend';
import { Skeleton } from '../components/ui';
import clsx from 'clsx';
import { formatCompact } from '../utils/format';

const LEADERBOARD_TIMEFRAMES: { label: string; value: LeaderboardTimeframe }[] = [
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
    { label: 'All Time', value: 'all' },
];

function safeUsd(n: string | number): number {
    const x = typeof n === 'number' ? n : parseFloat(String(n).replace(/,/g, ''));
    return Number.isFinite(x) ? x : 0;
}

function truncateAddress(address: string) {
    if (!address) return '—';
    if (address.length <= 13) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function LeaderboardPage() {
    const [timeframe, setTimeframe] = useState<LeaderboardTimeframe>('all');
    const { entries, loading, error } = useLeaderboard(50, timeframe);

    const getRankIcon = (rank: number) => {
        if (rank === 1) return <Medal className="w-6 h-6 text-yellow-400" />;
        if (rank === 2) return <Medal className="w-6 h-6 text-text-muted" />;
        if (rank === 3) return <Medal className="w-6 h-6 text-orange-400" />;
        return <span className="font-mono font-bold text-text-muted">#{rank}</span>;
    };

    return (
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center md:items-end gap-6 text-center md:text-left">
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
                    {LEADERBOARD_TIMEFRAMES.map(({ label, value }) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setTimeframe(value)}
                            className={clsx(
                                'px-4 py-2 rounded text-sm font-bold transition-all',
                                timeframe === value
                                    ? 'bg-[var(--bg-secondary)] text-text-primary shadow-sm'
                                    : 'text-text-muted hover:text-text-secondary'
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {error ? (
                <p className="text-center text-sm text-orange-400" role="alert">
                    {error}
                </p>
            ) : null}

            {/* Top 3 Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 lg:mb-8">
                {loading
                    ? Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="glass-panel p-4 sm:p-6 space-y-4">
                              <Skeleton className="h-10 w-full" />
                              <Skeleton className="h-8 w-2/3" />
                              <Skeleton className="h-6 w-1/2" />
                          </div>
                      ))
                    : entries.slice(0, 3).map((entry) => (
                          <motion.div
                              key={`${entry.rank}-${entry.wallet}`}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={clsx(
                                  'glass-panel p-4 sm:p-6 relative overflow-hidden border-t-4',
                                  entry.rank === 1
                                      ? 'border-yellow-400/50 bg-yellow-400/5'
                                      : entry.rank === 2
                                        ? 'border-[var(--border-color-hover)] bg-[var(--bg-tertiary)]/40'
                                        : 'border-orange-400/50 bg-orange-400/5'
                              )}
                          >
                              <div className="flex justify-between items-start mb-4">
                                  <div className="p-2 rounded-lg bg-[var(--bg-primary)]">{getRankIcon(entry.rank)}</div>
                                   <div className="bg-[var(--bg-tertiary)] px-2 py-1 rounded text-xs text-text-muted font-mono">
                                       {truncateAddress(entry.wallet)}
                                   </div>
                              </div>
                              <div className="space-y-1">
                                  <div className="text-sm text-text-secondary">Net PnL</div>
                                  <div
                                      className={clsx(
                                          'text-xl sm:text-2xl font-bold font-mono',
                                          safeUsd(entry.pnl) >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]'
                                      )}
                                  >
                                      {safeUsd(entry.pnl) >= 0 ? '+' : ''}
                                      {formatCompact(safeUsd(entry.pnl))}
                                  </div>
                              </div>
                              <div className="mt-4 pt-4 border-t border-[var(--border-color)] flex justify-between text-sm">
                                  <span className="text-text-muted">Volume</span>
                                  <span className="font-mono text-text-primary font-medium">
                                      {formatCompact(safeUsd(entry.volume))}
                                  </span>
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
                                    <td colSpan={5} className="px-6 py-8 text-center text-text-muted max-w-lg mx-auto text-sm leading-relaxed">
                                        No indexed trades for this period.
                                    </td>
                                </tr>
                            ) : (
                                entries.map((entry) => (
                                    <tr key={`${entry.rank}-${entry.wallet}`} className="group hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                {getRankIcon(entry.rank)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-500" />
                                                 <span className="font-mono text-sm text-[var(--primary)] font-medium md:hidden">{truncateAddress(entry.wallet)}</span>
                                                 <span className="font-mono text-sm text-[var(--primary)] font-medium hidden md:inline">{entry.wallet}</span>
                                             </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <span className={clsx(
                                                "font-mono font-bold",
                                                safeUsd(entry.pnl) >= 0 ? "text-[var(--long)]" : "text-[var(--short)]"
                                            )}>
                                                {safeUsd(entry.pnl) >= 0 ? '+' : ''}{formatCompact(safeUsd(entry.pnl))}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-sm text-text-primary">
                                            {formatCompact(safeUsd(entry.volume))}
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
                        <div className="p-8 text-center text-text-muted text-sm leading-relaxed">
                            No indexed trades for this period.
                        </div>
                    ) : (
                        entries.map((entry) => (
                            <div key={`${entry.rank}-${entry.wallet}`} className="p-4 bg-[var(--bg-secondary)]">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 flex items-center justify-center">
                                            {getRankIcon(entry.rank)}
                                        </div>
                                         <div className="flex items-center gap-2">
                                             <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-500" />
                                             <span className="font-mono text-sm text-[var(--primary)] font-bold">{truncateAddress(entry.wallet)}</span>
                                         </div>
                                    </div>
                                    <div className={clsx(
                                        "font-mono font-bold text-lg",
                                        safeUsd(entry.pnl) >= 0 ? "text-[var(--long)]" : "text-[var(--short)]"
                                    )}>
                                        {safeUsd(entry.pnl) >= 0 ? '+' : ''}{formatCompact(safeUsd(entry.pnl))}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-sm text-text-secondary pl-11">
                                    <div className="flex gap-4">
                                        <span>
                                            Vol: <span className="text-text-primary font-mono">{formatCompact(safeUsd(entry.volume))}</span>
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
