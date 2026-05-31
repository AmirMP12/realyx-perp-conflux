import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import clsx from 'clsx';
import { Market } from '../../services/markets';
import { formatCompact } from '../../utils/format';
import { CategoryTag } from '../ui/CategoryTag';
import { PriceTicker } from '../ui/PriceTicker';
import { MarketLogo } from '../MarketLogo';
import { FundingCountdown } from './FundingCountdown';

interface MarketHeaderProps {
    market: Market;
    markets: Market[];
    currentPrice: number;
    fundingRate: number;
    isLive: boolean;
}

export function MarketHeader({
    market,
    markets,
    currentPrice,
    fundingRate,
    isLive,
}: MarketHeaderProps) {
    const navigate = useNavigate();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [query, setQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    const change24h = market.change24h ?? 0;
    const isPositive = change24h >= 0;

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setDropdownOpen(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKey);
        };
    }, []);

    const sortedMarkets = [...markets]
        .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
        .filter((m) => {
            const q = query.trim().toLowerCase();
            if (!q) return true;
            return m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
        });

    const fundingClass = fundingRate > 0 ? 'text-[var(--short)]' : fundingRate < 0 ? 'text-[var(--long)]' : 'text-amber-400';

    return (
        <div className="glass-panel glass-panel-elevated relative z-30 rounded-2xl px-3 sm:px-4 lg:px-5 py-3 w-full">
            <div className="flex items-center justify-between gap-3 lg:gap-5">
                {/* Left: Market Selector + hero price */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div className="relative" ref={dropdownRef}>
                        <button
                            type="button"
                            onClick={() => setDropdownOpen((v) => !v)}
                            className="flex items-center gap-2.5 px-2 py-1.5 -ml-1.5 rounded-xl hover:bg-surface-3/55 transition-colors duration-200 min-h-[44px] touch-manipulation group min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            aria-expanded={dropdownOpen}
                            aria-haspopup="listbox"
                        >
                            <MarketLogo
                                src={market.image}
                                symbol={market.symbol}
                                name={market.name}
                                size="lg"
                                className="rounded-full ring-2 ring-line/80 group-hover:ring-[var(--border-color-hover)] transition-colors shrink-0"
                            />
                            <div className="flex flex-col items-start gap-0 min-w-0">
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                    <span data-testid="market-symbol" className="font-bold text-base sm:text-lg text-text-primary leading-tight tracking-tight truncate max-w-[88px] sm:max-w-none">{market.symbol}</span>
                                    <div className="hidden sm:block shrink-0">
                                        <CategoryTag category={market.category} size="xs" />
                                    </div>
                                    <ChevronDown className={clsx('w-4 h-4 text-text-muted transition-transform duration-200 shrink-0', dropdownOpen && 'rotate-180')} />
                                </div>
                                <span data-testid="market-name" className="hidden xs:block text-[10px] sm:text-xs text-text-muted truncate max-w-full">{market.name}</span>
                            </div>
                        </button>

                        {/* Dropdown */}
                        <div
                            role="listbox"
                            className={clsx(
                                'absolute top-full left-0 mt-3 w-80 max-w-[calc(100vw-2rem)] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl z-[100] overflow-hidden transition-all duration-200',
                                dropdownOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible pointer-events-none -translate-y-2',
                            )}
                        >
                            <div className="p-2.5 border-b border-[var(--border-color)]">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                                    <input
                                        type="text"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search markets…"
                                        className="w-full bg-[var(--bg-tertiary)] border border-line/70 rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-brand/50 transition-colors"
                                    />
                                </div>
                            </div>
                            <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                                {sortedMarkets.length === 0 ? (
                                    <div className="px-4 py-6 text-center text-sm text-text-muted">No markets found</div>
                                ) : sortedMarkets.map((m) => (
                                    <button
                                        type="button"
                                        key={`${m.id}-${m.marketAddress}`}
                                        onClick={() => {
                                            navigate(`/trade/${m.symbol}`);
                                            setDropdownOpen(false);
                                            setQuery('');
                                        }}
                                        className={clsx(
                                            'w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors border-b border-line/40 last:border-0 focus:outline-none focus-visible:bg-[var(--bg-tertiary)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/25',
                                            m.id === market.id && 'bg-brand/10',
                                        )}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <MarketLogo src={m.image} symbol={m.symbol} name={m.name} size="md" className="rounded-full shrink-0" />
                                            <div className="flex flex-col items-start min-w-0">
                                                <span className={clsx('text-sm font-bold truncate', m.id === market.id ? 'text-[var(--primary)]' : 'text-text-primary')}>{m.symbol}</span>
                                                <span className="text-[11px] text-text-muted truncate">{m.name}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-0.5 shrink-0 pl-2">
                                            <div className={clsx('text-sm font-bold tabular-nums', m.change24h >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                                                {m.change24h >= 0 ? '+' : ''}{m.change24h?.toFixed(2)}%
                                            </div>
                                            <span className="text-[10px] text-text-muted tabular-nums">
                                                Vol {formatCompact(m.volume24h || 0)}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Hero price + live dot */}
                    <div className="flex flex-col items-start pl-2 sm:pl-4 sm:border-l border-line/60 min-w-0">
                        <div className="flex items-center gap-2">
                            <PriceTicker value={currentPrice} prefix="$" decimals={currentPrice < 1 ? 4 : 2} className="text-xl sm:text-2xl font-bold font-mono text-text-primary tabular-nums leading-none" />
                            <span
                                className={clsx('w-1.5 h-1.5 rounded-full shrink-0', isLive ? 'bg-emerald-400 animate-pulse' : 'bg-text-muted')}
                                title={isLive ? 'Live price' : 'Awaiting data'}
                                aria-hidden
                            />
                        </div>
                        <span className={clsx('text-xs sm:text-sm font-semibold tabular-nums leading-tight mt-0.5', isPositive ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                            {isPositive ? '+' : ''}{change24h.toFixed(2)}%
                            <span className="text-text-muted font-normal ml-1">24h</span>
                        </span>
                    </div>
                </div>

                {/* Right: Stats Row (Desktop) */}
                <div className="hidden lg:grid grid-flow-col auto-cols-max items-center gap-x-6 xl:gap-x-8 pr-1">
                    <Stat label="24h Volume" value={formatCompact(market.volume24h ?? 0)} />
                    <Stat label="Open Interest" value={formatCompact(market.openInterest ?? 0)} />
                    <Stat
                        label="Funding / 1h"
                        value={
                            <span className={fundingClass}>
                                {fundingRate > 0 ? '+' : ''}{((fundingRate * 100) / 8).toFixed(4)}%
                            </span>
                        }
                        sub={<FundingCountdown />}
                    />
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-end text-right">
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-medium mb-1">{label}</span>
            <div className="text-sm font-mono font-semibold tabular-nums leading-tight text-text-primary">{value}</div>
            {sub ? <div className="mt-0.5">{sub}</div> : null}
        </div>
    );
}
