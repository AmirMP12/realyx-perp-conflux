import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, AlertTriangle, Search } from 'lucide-react';
import clsx from 'clsx';
import { useMarketsStore } from '../stores';
import { useMarkets, useBackendStats } from '../hooks/useBackend';
import { useVaultStats } from '../hooks/useVault';
import { Sparkline } from '../components/Sparkline';
import { useMarketPriceHistory } from '../hooks/useMarketPriceHistory';
import { formatCompact, formatPriceWithPrecision } from '../utils/format';
import { Skeleton } from '../components/ui/Skeleton';

import { MARKET_DISPLAY_FALLBACK } from '../config/markets';
import { CategoryTag } from '../components/ui/CategoryTag';

function marketDisplayName(m: { marketAddress: string; name: string; symbol: string; image?: string }) {
    const key = m.marketAddress?.toLowerCase();
    const fallback = key ? MARKET_DISPLAY_FALLBACK[key] : null;
    return {
        name: fallback?.name ?? m.name,
        symbol: fallback?.symbol ?? m.symbol,
        image: fallback?.image ?? m.image ?? "",
    };
}

interface DisplayMarket {
    id: string;
    name: string;
    symbol: string;
    indexPrice: number;
    volume24h: number;
    longOI: number;
    shortOI: number;
    fundingRate: number;
    change24h: number;
    marketAddress: string;
    image: string;
    category?: string;
}

export function MarketsPage() {
    const markets = useMarketsStore((s) => s.markets);
    const storeLoading = useMarketsStore((s) => s.loading);
    const { loading: networkLoading, error: marketsError, refetch: refetchMarkets } = useMarkets();
    const { stats: backendStats, loading: statsLoading, refetch: refetchStats } = useBackendStats();
    const { stats: vaultStats, loading: vaultLoading } = useVaultStats();

    const favorites = useMarketsStore((s) => s.favorites);
    const toggleFavorite = useMarketsStore((s) => s.toggleFavorite);

    const isLoading = markets.length === 0 && (networkLoading || storeLoading);
    const apiMarkets = markets;

    const [filter, setFilter] = useState<'all' | 'favorites'>('all');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [search, setSearch] = useState('');

    const categories = [
        { id: 'all', label: 'All' },
        { id: 'CRYPTO', label: 'Crypto' },
        { id: 'STOCK', label: 'Equities' },
        { id: 'COMMODITY', label: 'Commodities' },
        { id: 'FOREX', label: 'Forex' },
    ];

    const displayMarkets: DisplayMarket[] = apiMarkets.map(m => {
        const display = marketDisplayName({ ...m, image: m.image ?? "" });
        return {
            id: m.id,
            name: display.name,
            symbol: display.symbol,
            indexPrice: parseFloat(String(m.indexPrice)),
            volume24h: parseFloat(String(m.volume24h)),
            longOI: parseFloat(String(m.longOI)),
            shortOI: parseFloat(String(m.shortOI)),
            fundingRate: parseFloat(String(m.fundingRate)),
            change24h: m.change24h ?? 0,
            marketAddress: m.marketAddress,
            image: display.image,
            category: (m as any).category || 'CRYPTO',
        };
    }).sort((a, b) => {
        if (a.symbol === 'CFX-USD') return -1;
        if (b.symbol === 'CFX-USD') return 1;
        return 0;
    });


    const filteredMarkets = displayMarkets.filter(m => {
        const matchesFilter = filter === 'favorites' ? favorites.includes(m.id) : true;
        const matchesCategory = categoryFilter === 'all' || (m as any).category === categoryFilter;
        const matchesSearch = m.symbol.toLowerCase().includes(search.toLowerCase()) || m.name.toLowerCase().includes(search.toLowerCase());
        return matchesFilter && matchesCategory && matchesSearch;
    });

    const volume24h = backendStats ? parseFloat(backendStats.volume24h) : 0;
    const totalOpenInterest = backendStats ? parseFloat(backendStats.totalOpenInterest) : 0;
    const tvl = vaultStats?.tvl ?? 0;

    const handleRefresh = async () => {
        await Promise.all([refetchMarkets(), refetchStats()]);
    };

    return (
        <div className="space-y-7 animate-in fade-in duration-500 min-w-0">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 px-4 md:px-0">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 tracking-tight">Markets</h1>
                    <p className="text-text-secondary text-sm md:text-base max-w-2xl">
                        Trade perpetuals with up to 10x leverage. Crypto, equities, commodities & RWAs.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-400 uppercase tracking-wider shadow-[0_0_0_1px_rgba(16,185,129,0.1)]">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Operational
                    </div>
                </div>
            </div>

            {/* Global Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-4 md:px-0">
                <StatCard label="24h Volume" value={formatCompact(volume24h)} loading={statsLoading} />
                <StatCard label="Open Interest" value={formatCompact(totalOpenInterest)} loading={statsLoading} />
                <StatCard label="Total Value Locked" value={formatCompact(tvl)} loading={vaultLoading} />
                <StatCard label="Total Markets" value={String(apiMarkets.length)} loading={isLoading} />
            </div>

            {/* Markets Table Container */}
            <div className="bg-[var(--bg-secondary)]/90 border-y md:border border-[var(--border-color)] md:rounded-2xl overflow-hidden shadow-[0_14px_35px_rgba(0,0,0,0.28)]">
                {/* Controls */}
                <div className="p-4 border-b border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex bg-[var(--bg-tertiary)]/70 rounded-xl p-1 w-fit border border-[var(--border-color)]/60">
                            <button
                                onClick={() => setFilter('all')}
                                className={clsx(
                                    "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                                    filter === 'all' ? "bg-[var(--bg-secondary)] text-white shadow-sm" : "text-text-secondary hover:text-text-primary"
                                )}
                            >
                                All Markets
                            </button>
                            <button
                                onClick={() => setFilter('favorites')}
                                className={clsx(
                                    "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                                    filter === 'favorites' ? "bg-[var(--bg-secondary)] text-amber-400 shadow-sm" : "text-text-secondary hover:text-amber-400"
                                )}
                            >
                                <Star className="w-3.5 h-3.5" fill={filter === 'favorites' ? "currentColor" : "none"} />
                                Favorites
                            </button>
                        </div>
                        <div className="flex bg-[var(--bg-tertiary)]/70 rounded-xl p-1 w-fit overflow-x-auto border border-[var(--border-color)]/60">
                            {categories.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => setCategoryFilter(cat.id)}
                                    className={clsx(
                                        "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                                        categoryFilter === cat.id ? "bg-[var(--bg-secondary)] text-white shadow-sm" : "text-text-secondary hover:text-text-primary"
                                    )}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                        <input
                            type="text"
                            placeholder="Search markets..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-[var(--bg-tertiary)]/80 border border-[var(--border-color)]/60 focus:border-[var(--border-color-hover)] rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none transition-colors"
                        />
                    </div>
                </div>

                {/* Loading / Error States */}
                {(isLoading && displayMarkets.length === 0) ? (
                    <MarketsTableSkeleton />
                ) : marketsError ? (
                    <div className="py-20 flex flex-col items-center justify-center text-rose-400">
                        <AlertTriangle className="w-12 h-12 mb-4 opacity-80" />
                        <p className="font-semibold text-text-primary">Failed to load markets</p>
                        <p className="text-sm text-text-secondary mt-1">Check your connection and try again</p>
                        <button onClick={handleRefresh} className="mt-6 px-6 py-2.5 bg-[var(--bg-tertiary)] rounded-lg hover:bg-[var(--border-color)] text-text-primary text-sm font-medium transition-colors border border-[var(--border-color)]">
                            Retry
                        </button>
                    </div>
                ) : filteredMarkets.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center text-text-muted">
                        <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
                            <Search className="w-8 h-8 opacity-50" />
                        </div>
                        <p className="font-semibold text-text-primary">No markets found</p>
                        <p className="text-sm mt-1 text-center px-4">
                            {filter === 'favorites' ? 'Star markets to add them to your favorites.' : 'Try a different search term.'}
                        </p>
                        {filter === 'favorites' && (
                            <button onClick={() => setFilter('all')} className="mt-4 px-4 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary)]/10 rounded-lg transition-colors">
                                View all markets
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Desktop Table */}
                        <div className="hidden md:block overflow-x-auto max-h-[70vh] overflow-y-auto">
                            <table className="w-full text-left">
                                <thead className="bg-[var(--bg-tertiary)]/60 text-xs uppercase text-text-secondary font-medium sticky top-0 z-10 backdrop-blur-sm">
                                    <tr>
                                        <th className="px-6 py-3">Market</th>
                                        <th className="px-6 py-3 text-right">Price</th>
                                        <th className="px-6 py-3 text-right">24h Change</th>
                                        <th className="px-6 py-3 text-right">24h Volume</th>
                                        <th className="px-6 py-3 text-right">Open Interest</th>
                                        <th className="px-6 py-3 text-right">Funding / 1h</th>
                                        <th className="px-6 py-3 text-right">Last 7 Days</th>
                                        <th className="px-6 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border-color)]/70">
                                    {filteredMarkets.map((market) => (
                                        <MarketRow
                                            key={market.id}
                                            market={market}
                                            isFavorite={favorites.includes(market.id)}
                                            toggleFavorite={toggleFavorite}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile List */}
                        <div className="md:hidden divide-y divide-[var(--border-color)]">
                            {filteredMarkets.map((market) => (
                                <MobileMarketCard
                                    key={market.id}
                                    market={market}
                                    isFavorite={favorites.includes(market.id)}
                                    toggleFavorite={toggleFavorite}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function MarketsTableSkeleton() {
    return (
        <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="flex items-center gap-6 py-4 border-b border-[var(--border-color)] last:border-0">
                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-14" />
                </div>
            ))}
        </div>
    );
}

function StatCard({ label, value, loading }: { label: string, value: string, loading: boolean }) {
    return (
        <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] p-4 rounded-2xl border border-[var(--border-color)] shadow-[0_10px_28px_rgba(0,0,0,0.2)] hover:border-[var(--border-color-hover)] transition-all duration-200">
            <div className="text-[11px] text-text-secondary mb-1 uppercase tracking-[0.12em] font-semibold">{label}</div>
            {loading ? (
                <Skeleton className="h-7 w-24" />
            ) : (
                <div className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/80 font-mono tracking-tight tabular-nums">
                    {value}
                </div>
            )}
        </div>
    );
}

function MarketRow({ market, isFavorite, toggleFavorite }: { market: DisplayMarket, isFavorite: boolean, toggleFavorite: (id: string) => void }) {
    const marketKey = market.marketAddress || market.id;
    const { prices } = useMarketPriceHistory(marketKey, 7);
    const isPositive = market.change24h >= 0;

    return (
        <tr className="hover:bg-[var(--bg-tertiary)]/35 transition-colors duration-150 group">
            <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            toggleFavorite(market.id);
                        }}
                        className={clsx(
                            "p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors",
                            isFavorite ? "text-amber-400" : "text-text-muted hover:text-amber-400"
                        )}
                    >
                        <Star className="w-4 h-4" fill={isFavorite ? "currentColor" : "none"} />
                    </button>
                    <Link to={`/trade/${market.symbol}`} className="flex items-center gap-3">
                        <img src={market.image} alt={market.symbol} className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] ring-1 ring-[var(--border-color)]/70" />
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-text-primary text-sm">{market.symbol}</span>
                                <CategoryTag category={market.category} size="xs" />
                            </div>
                            <div className="text-xs text-text-muted">{market.name}</div>
                        </div>
                    </Link>
                </div>
            </td>
            <td className="px-6 py-4 text-right">
                <div className="font-mono font-medium text-text-primary">
                    ${formatPriceWithPrecision(market.indexPrice)}
                </div>
            </td>
            <td className="px-6 py-4 text-right">
                <div className={clsx("font-mono font-medium", isPositive ? "text-[var(--long)]" : "text-[var(--short)]")}>
                    {isPositive ? '+' : ''}{market.change24h.toFixed(2)}%
                </div>
            </td>
            <td className="px-6 py-4 text-right text-text-secondary font-mono text-sm">
                {formatCompact(market.volume24h)}
            </td>
            <td className="px-6 py-4 text-right font-mono text-sm">
                <div className="text-text-primary">{formatCompact(market.longOI + market.shortOI)}</div>
                <div className="flex h-1 w-full bg-[var(--bg-tertiary)] rounded-full mt-1.5 overflow-hidden max-w-[80px] ml-auto">
                    <div className="bg-[var(--long)] h-full" style={{ width: `${(market.longOI / (market.longOI + market.shortOI || 1)) * 100}%` }} />
                    <div className="bg-[var(--short)] h-full" style={{ width: `${(market.shortOI / (market.longOI + market.shortOI || 1)) * 100}%` }} />
                </div>
            </td>
            <td className="px-6 py-4 text-right">
                <div className={clsx("font-mono text-sm", market.fundingRate >= 0 ? "text-[var(--long)]" : "text-[var(--short)]")}>
                    {(market.fundingRate * 100).toFixed(4)}%
                </div>
            </td>
            <td className="px-6 py-4 text-right">
                <div className="w-[100px] h-[30px] ml-auto">
                    <Sparkline data={prices} width={100} height={30} positiveColor="#30e0a1" negativeColor="#fa3c58" />
                </div>
            </td>
            <td className="px-6 py-4 text-right">
                <Link to={`/trade/${market.symbol}`}>
                    <button className="px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--primary)] text-text-primary hover:text-white rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border border-[var(--border-color)]/60 hover:border-transparent">
                        Trade
                    </button>
                </Link>
            </td>
        </tr>
    );
}

function MobileMarketCard({ market, isFavorite, toggleFavorite }: { market: DisplayMarket, isFavorite: boolean, toggleFavorite: (id: string) => void }) {
    const marketKey = market.marketAddress || market.id;
    const { prices } = useMarketPriceHistory(marketKey, 7);
    const isPositive = market.change24h >= 0;

    return (
        <Link to={`/trade/${market.symbol}`} className="block p-4 active:bg-[var(--bg-tertiary)] transition-colors relative">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <img src={market.image} alt={market.symbol} className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)]" />
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-text-primary text-sm">{market.symbol}</span>
                            <CategoryTag category={market.category} size="xs" />
                        </div>
                        <div className="text-xs text-text-muted">{market.name}</div>
                    </div>
                </div>
                <div className="text-right">
                    <div className="font-mono font-medium text-text-primary text-lg">
                        ${formatPriceWithPrecision(market.indexPrice)}
                    </div>
                    <div className={clsx("text-xs font-medium", isPositive ? "text-[var(--long)]" : "text-[var(--short)]")}>
                        {isPositive ? '+' : ''}{market.change24h.toFixed(2)}%
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-text-secondary mt-2">
                <div className="flex gap-4 items-center">
                    <span>
                        Vol: <span className="text-text-primary font-mono">{formatCompact(market.volume24h)}</span>
                    </span>
                    <span>
                        Funding: <span className={clsx("font-mono", market.fundingRate >= 0 ? "text-[var(--long)]" : "text-[var(--short)]")}>{(market.fundingRate * 100).toFixed(4)}%</span>
                    </span>
                    <div className="w-[60px] h-[20px] shrink-0">
                        <Sparkline data={prices} width={60} height={20} positiveColor="#30e0a1" negativeColor="#fa3c58" />
                    </div>
                </div>
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFavorite(market.id);
                    }}
                    className="p-2 -m-2 z-10"
                >
                    <Star className={clsx("w-5 h-5", isFavorite ? "text-amber-400 fill-amber-400" : "text-text-muted/50")} />
                </button>
            </div>
        </Link>
    );
}
