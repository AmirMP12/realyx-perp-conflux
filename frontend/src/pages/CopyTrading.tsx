import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Users,
    TrendingUp,
    Award,
    Activity,
    Copy as CopyIcon,
    Search,
    Trophy,
    Wallet,
    ArrowRight,
    Info,
    RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useTopTraders, useFollowing, useCopierPnl, type LeadTrader } from '../hooks/useSocial';
import { Skeleton } from '../components/ui';
import { formatCompact, safeUsd, truncateAddress } from '../utils/format';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const COPY_TRADING_ENABLED =
    (import.meta.env.VITE_COPY_REGISTRY_ADDRESS || ZERO_ADDRESS) !== ZERO_ADDRESS &&
    (import.meta.env.VITE_COPY_BOT_ADDRESS || ZERO_ADDRESS) !== ZERO_ADDRESS;

function avatarColor(address: string) {
    const seed = parseInt(address.slice(2, 8) || '0', 16);
    const hue = seed % 360;
    return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 70% 45%))`;
}

type Tab = 'discover' | 'copies';

export function CopyTradingPage() {
    const { isConnected } = useAccount();
    const [tab, setTab] = useState<Tab>('discover');

    return (
        <div className="space-y-7 animate-in fade-in duration-500 min-w-0">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 px-4 md:px-0">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-text-primary mb-2 tracking-tight flex items-center gap-3">
                        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
                            <CopyIcon className="w-5 h-5 text-white" />
                        </span>
                        Copy Trading
                    </h1>
                    <p className="text-text-secondary text-sm md:text-base max-w-2xl">
                        Mirror top-performing traders automatically. Allocate capital, set your limits, and let the
                        CopyBot replicate their moves on-chain.
                    </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <span
                        className={clsx(
                            'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border',
                            COPY_TRADING_ENABLED
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                : 'bg-amber-500/10 border-amber-500/20 text-amber-400',
                        )}
                    >
                        <span
                            className={clsx(
                                'w-1.5 h-1.5 rounded-full',
                                COPY_TRADING_ENABLED ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500',
                            )}
                        />
                        {COPY_TRADING_ENABLED ? 'Live' : 'Coming Soon'}
                    </span>
                </div>
            </div>

            {/* Tabs */}
            <div className="px-4 md:px-0">
                <div className="inline-flex items-center rounded-xl bg-surface-3/60 border border-line/70 p-1 gap-0.5">
                    <TabButton active={tab === 'discover'} onClick={() => setTab('discover')} icon={<Trophy className="w-4 h-4" />}>
                        Discover
                    </TabButton>
                    <TabButton active={tab === 'copies'} onClick={() => setTab('copies')} icon={<Wallet className="w-4 h-4" />}>
                        My Copies
                    </TabButton>
                </div>
            </div>

            <div className="px-4 md:px-0">
                {tab === 'discover' ? <DiscoverTab /> : <MyCopiesTab isConnected={isConnected} onBrowse={() => setTab('discover')} />}
            </div>
        </div>
    );
}

function TabButton({
    active,
    onClick,
    icon,
    children,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                'h-9 px-4 inline-flex items-center gap-2 rounded-lg text-sm font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                active
                    ? 'text-brand bg-brand/15 shadow-[0_0_0_1px_rgba(45,66,252,0.25)]'
                    : 'text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]',
            )}
        >
            {icon}
            {children}
        </button>
    );
}

// ─── Discover ───────────────────────────────────────────────────────

function DiscoverTab() {
    const { traders, loading, error, refetch } = useTopTraders();
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<'roi' | 'pnl' | 'followers'>('roi');

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = traders.filter((t) => !q || t.address.toLowerCase().includes(q));
        return [...list].sort((a, b) => {
            if (sort === 'pnl') return safeUsd(b.totalPnl) - safeUsd(a.totalPnl);
            if (sort === 'followers') return b.activeFollowers - a.activeFollowers;
            return b.roi - a.roi;
        });
    }, [traders, search, sort]);

    const aggregate = useMemo(() => {
        const totalFollowers = traders.reduce((acc, t) => acc + (t.activeFollowers || 0), 0);
        const avgWin = traders.length
            ? traders.reduce((acc, t) => acc + (t.winRate || 0), 0) / traders.length
            : 0;
        const totalPnl = traders.reduce((acc, t) => acc + safeUsd(t.totalPnl), 0);
        return { totalFollowers, avgWin, totalPnl, count: traders.length };
    }, [traders]);

    return (
        <div className="space-y-6">
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryStat label="Lead Traders" value={String(aggregate.count)} loading={loading} icon={<Users className="w-4 h-4" />} />
                <SummaryStat label="Total Followers" value={formatCompact(aggregate.totalFollowers, { noDollar: true })} loading={loading} icon={<Activity className="w-4 h-4" />} />
                <SummaryStat label="Avg Win Rate" value={`${aggregate.avgWin.toFixed(1)}%`} loading={loading} icon={<Award className="w-4 h-4" />} />
                <SummaryStat label="Combined PnL" value={formatCompact(aggregate.totalPnl)} loading={loading} icon={<TrendingUp className="w-4 h-4" />} />
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-80 group">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted transition-colors group-focus-within:text-[var(--primary)]" />
                    <input
                        type="text"
                        placeholder="Search by address..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-[var(--bg-secondary)] border border-line/80 focus:border-brand/40 rounded-xl pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none transition-all focus:ring-1 focus:ring-brand/20"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex bg-surface-3/70 rounded-xl p-1 border border-line/60">
                        {([
                            { id: 'roi', label: 'ROI' },
                            { id: 'pnl', label: 'PnL' },
                            { id: 'followers', label: 'Followers' },
                        ] as const).map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSort(s.id)}
                                className={clsx(
                                    'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all',
                                    sort === s.id ? 'bg-[var(--bg-secondary)] text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                                )}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        aria-label="Refresh traders"
                        className="h-9 w-9 inline-flex items-center justify-center rounded-xl bg-[var(--bg-tertiary)] border border-line/60 text-text-secondary hover:text-text-primary transition-colors"
                    >
                        <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
                    </button>
                </div>
            </div>

            {error ? (
                <p className="text-center text-sm text-amber-400 py-4" role="alert">
                    {error}
                </p>
            ) : null}

            {/* Grid */}
            {loading && traders.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="glass-panel p-5 space-y-4">
                            <Skeleton className="h-10 w-32" />
                            <Skeleton className="h-8 w-24" />
                            <Skeleton className="h-12 w-full" />
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<Trophy className="w-8 h-8" />}
                    title="No lead traders yet"
                    description={
                        COPY_TRADING_ENABLED
                            ? 'No traders have opted in as copy leaders. Check back soon.'
                            : 'Copy trading is not enabled on this deployment yet. Lead traders will appear here once it goes live.'
                    }
                />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((trader, i) => (
                        <TraderCard key={trader.address} trader={trader} rank={sort === 'roi' ? i + 1 : undefined} />
                    ))}
                </div>
            )}
        </div>
    );
}

function TraderCard({ trader, rank }: { trader: LeadTrader; rank?: number }) {
    const pnl = safeUsd(trader.totalPnl);
    const pnlPositive = pnl >= 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
        >
            <Link
                to={`/trader/${trader.address}`}
                className="glass-panel block p-5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-[var(--radius-panel)]"
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
                            style={{ background: avatarColor(trader.address) }}
                        >
                            {trader.address.slice(2, 4).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <div className="font-mono font-bold text-text-primary text-sm truncate">
                                {truncateAddress(trader.address)}
                            </div>
                            <div className="text-xs text-text-muted flex items-center gap-1.5">
                                <Users className="w-3 h-3" />
                                {trader.activeFollowers} followers
                            </div>
                        </div>
                    </div>
                    {rank && rank <= 3 ? (
                        <span
                            className={clsx(
                                'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0',
                                rank === 1
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : rank === 2
                                      ? 'bg-[var(--bg-tertiary)] text-text-secondary'
                                      : 'bg-orange-500/20 text-orange-400',
                            )}
                        >
                            #{rank}
                        </span>
                    ) : null}
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                    <MiniStat label="ROI" value={`${trader.roi >= 0 ? '+' : ''}${trader.roi.toFixed(1)}%`} tone={trader.roi >= 0 ? 'long' : 'short'} />
                    <MiniStat label="Win Rate" value={`${trader.winRate.toFixed(0)}%`} />
                    <MiniStat label="Trades" value={String(trader.totalTrades)} />
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-[var(--border-color)]">
                    <div>
                        <div className="text-[11px] text-text-muted uppercase tracking-wider">Total PnL</div>
                        <div className={clsx('font-mono font-bold', pnlPositive ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                            {pnlPositive ? '+' : ''}
                            {formatCompact(pnl)}
                        </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--primary)] group-hover:gap-2.5 transition-all">
                        View
                        <ArrowRight className="w-4 h-4" />
                    </span>
                </div>

                {trader.profitFeeBps > 0 && (
                    <div className="mt-3 text-[11px] text-text-muted">
                        Profit fee: <span className="text-text-secondary font-medium">{(trader.profitFeeBps / 100).toFixed(1)}%</span>
                    </div>
                )}
            </Link>
        </motion.div>
    );
}

// ─── My Copies ──────────────────────────────────────────────────────

function MyCopiesTab({ isConnected, onBrowse }: { isConnected: boolean; onBrowse: () => void }) {
    const { following, loading, error } = useFollowing();
    const { pnl } = useCopierPnl();

    if (!isConnected) {
        return (
            <div className="glass-panel p-10 flex flex-col items-center text-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center text-text-muted">
                    <Wallet className="w-7 h-7" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-text-primary">Connect your wallet</h3>
                    <p className="text-sm text-text-secondary mt-1 max-w-sm">
                        Connect to see the traders you're copying, your allocations, and copied PnL.
                    </p>
                </div>
                <ConnectButton />
            </div>
        );
    }

    const totalPnl = safeUsd(pnl?.totalCopiedPnl ?? 0);
    const totalAllocation = following.reduce((acc, f) => acc + safeUsd(f.maxAllocation), 0);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <SummaryStat label="Copying" value={String(following.length)} loading={loading} icon={<Users className="w-4 h-4" />} />
                <SummaryStat label="Allocated" value={formatCompact(totalAllocation)} loading={loading} icon={<Wallet className="w-4 h-4" />} />
                <SummaryStat
                    label="Copied PnL"
                    value={`${totalPnl >= 0 ? '+' : ''}${formatCompact(totalPnl)}`}
                    loading={loading}
                    icon={<TrendingUp className="w-4 h-4" />}
                    tone={totalPnl >= 0 ? 'long' : 'short'}
                    className="col-span-2 md:col-span-1"
                />
            </div>

            {error ? (
                <p className="text-center text-sm text-amber-400 py-4" role="alert">
                    {error}
                </p>
            ) : null}

            {loading && following.length === 0 ? (
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 w-full rounded-[var(--radius-panel)]" />
                    ))}
                </div>
            ) : following.length === 0 ? (
                <EmptyState
                    icon={<CopyIcon className="w-8 h-8" />}
                    title="You're not copying anyone yet"
                    description="Discover top traders and start copying to mirror their strategies automatically."
                    action={
                        <button
                            type="button"
                            onClick={() => {
                                onBrowse();
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="btn-primary inline-flex items-center gap-2 text-sm"
                        >
                            <Trophy className="w-4 h-4" />
                            Browse Lead Traders
                        </button>
                    }
                />
            ) : (
                <div className="glass-panel overflow-hidden">
                    {/* Desktop table */}
                    <table className="w-full hidden md:table">
                        <thead>
                            <tr className="border-b border-[var(--border-color)] bg-surface-3/30 text-xs uppercase tracking-wider text-text-secondary">
                                <th className="px-6 py-4 text-left font-bold">Trader</th>
                                <th className="px-6 py-4 text-right font-bold">Allocation</th>
                                <th className="px-6 py-4 text-right font-bold">Max Lev</th>
                                <th className="px-6 py-4 text-right font-bold">Copied PnL</th>
                                <th className="px-6 py-4 text-right font-bold">Since</th>
                                <th className="px-6 py-4" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {following.map((f) => {
                                const fPnl = safeUsd(pnl?.pnlByTrader?.[f.address.toLowerCase()] ?? f.copiedPnl);
                                return (
                                    <tr key={f.address} className="hover:bg-surface-3/40 transition-colors">
                                        <td className="px-6 py-4">
                                            <Link to={`/trader/${f.address}`} className="flex items-center gap-3 group">
                                                <div
                                                    className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
                                                    style={{ background: avatarColor(f.address) }}
                                                >
                                                    {f.address.slice(2, 4).toUpperCase()}
                                                </div>
                                                <span className="font-mono text-sm text-[var(--primary)] font-medium group-hover:underline">
                                                    {truncateAddress(f.address)}
                                                </span>
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-sm text-text-primary">
                                            {formatCompact(safeUsd(f.maxAllocation))}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-sm text-text-secondary">{f.maxLeverage}x</td>
                                        <td className={clsx('px-6 py-4 text-right font-mono text-sm font-bold', fPnl >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                                            {fPnl >= 0 ? '+' : ''}
                                            {formatCompact(fPnl)}
                                        </td>
                                        <td className="px-6 py-4 text-right text-xs text-text-muted">{formatDate(f.startedAt)}</td>
                                        <td className="px-6 py-4 text-right">
                                            <Link to={`/trader/${f.address}`} className="text-sm font-medium text-[var(--primary)] hover:underline">
                                                Manage
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Mobile list */}
                    <div className="md:hidden divide-y divide-[var(--border-color)]">
                        {following.map((f) => {
                            const fPnl = safeUsd(pnl?.pnlByTrader?.[f.address.toLowerCase()] ?? f.copiedPnl);
                            return (
                                <Link key={f.address} to={`/trader/${f.address}`} className="flex items-center justify-between p-4 active:bg-surface-3/40">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div
                                            className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
                                            style={{ background: avatarColor(f.address) }}
                                        >
                                            {f.address.slice(2, 4).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-mono text-sm text-text-primary truncate">{truncateAddress(f.address)}</div>
                                            <div className="text-xs text-text-muted">
                                                {formatCompact(safeUsd(f.maxAllocation))} · {f.maxLeverage}x
                                            </div>
                                        </div>
                                    </div>
                                    <div className={clsx('font-mono text-sm font-bold shrink-0', fPnl >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                                        {fPnl >= 0 ? '+' : ''}
                                        {formatCompact(fPnl)}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="flex items-start gap-2 text-xs text-text-muted px-1">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <p>
                    Copied PnL reflects positions mirrored by the CopyBot on your behalf. Allocations are capped by the
                    limits you set when you started copying each trader.
                </p>
            </div>
        </div>
    );
}

// ─── Shared bits ────────────────────────────────────────────────────

function SummaryStat({
    label,
    value,
    loading,
    icon,
    tone,
    className,
}: {
    label: string;
    value: string;
    loading?: boolean;
    icon: React.ReactNode;
    tone?: 'long' | 'short';
    className?: string;
}) {
    return (
        <div className={clsx('glass-card p-4 min-w-0', className)}>
            <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] text-text-secondary uppercase tracking-[0.12em] font-semibold truncate">{label}</span>
                <span className="text-[var(--primary)] p-1.5 bg-brand/10 rounded-lg shrink-0">{icon}</span>
            </div>
            {loading ? (
                <Skeleton className="h-7 w-20" />
            ) : (
                <div
                    className={clsx(
                        'text-xl font-bold font-mono tracking-tight tabular-nums truncate',
                        tone === 'long' ? 'text-[var(--long)]' : tone === 'short' ? 'text-[var(--short)]' : 'text-text-primary',
                    )}
                    title={value}
                >
                    {value}
                </div>
            )}
        </div>
    );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'long' | 'short' }) {
    return (
        <div className="rounded-lg bg-surface-3/50 border border-line/60 px-2.5 py-2 text-center min-w-0">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5 truncate">{label}</div>
            <div
                className={clsx(
                    'font-mono font-bold text-sm tabular-nums truncate',
                    tone === 'long' ? 'text-[var(--long)]' : tone === 'short' ? 'text-[var(--short)]' : 'text-text-primary',
                )}
                title={value}
            >
                {value}
            </div>
        </div>
    );
}

function EmptyState({
    icon,
    title,
    description,
    action,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="glass-panel py-16 px-6 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-text-muted">
                {icon}
            </div>
            <div>
                <h3 className="font-semibold text-text-primary text-lg">{title}</h3>
                <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">{description}</p>
            </div>
            {action}
        </div>
    );
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

export default CopyTradingPage;
