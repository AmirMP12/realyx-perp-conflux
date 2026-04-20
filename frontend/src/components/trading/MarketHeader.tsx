import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { Market } from '../../services/markets';
import { formatCompact } from '../../utils/format';
import { CategoryTag } from '../ui/CategoryTag';
import { PriceTicker } from '../ui/PriceTicker';
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
    isLive: _isLive,
}: MarketHeaderProps) {
    const navigate = useNavigate();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const change24h = market.change24h ?? 0;
    const isPositive = change24h >= 0;

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative z-30 flex items-center justify-between gap-2 px-3 lg:px-6 py-1.5 sm:py-3 border-b border-[var(--border-color)]/80 bg-[var(--bg-secondary)]/95 backdrop-blur-md w-full shadow-lg">
            {/* Left: Market Selector */}
            <div className="relative" ref={dropdownRef}>
                <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="flex items-center gap-2.5 px-2 py-1.5 -ml-1.5 rounded-xl hover:bg-[var(--bg-tertiary)]/55 transition-colors duration-200 min-h-[44px] touch-manipulation group min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                    aria-expanded={dropdownOpen}
                    aria-haspopup="listbox"
                >
                    <div className="relative shrink-0">
                        <img src={market.image} alt={market.name} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full ring-2 ring-[var(--border-color)]/80 group-hover:ring-[var(--border-color-hover)] transition-colors" />
                    </div>
                    <div className="flex flex-col items-start gap-0 min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                            <span data-testid="market-symbol" className="font-bold text-base sm:text-xl text-text-primary leading-tight tracking-tight truncate max-w-[80px] xs:max-w-[120px] sm:max-w-none">{market.symbol}</span>
                            <div className="shrink-0 scale-[0.85] sm:scale-100 origin-left">
                                <CategoryTag category={market.category} size="xs" />
                            </div>
                            <ChevronDown className={clsx("w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted transition-transform duration-200 shrink-0", dropdownOpen && "rotate-180")} />
                        </div>
                        <span data-testid="market-name" className="hidden xs:block text-[10px] sm:text-xs text-text-muted truncate max-w-full">{market.name}</span>
                    </div>
                </button>

                {/* Dropdown - click/tap for mobile */}
                <div
                    role="listbox"
                    className={clsx(
                        "absolute top-full left-0 mt-3 w-72 max-w-[calc(100vw-2rem)] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[100] overflow-hidden transition-all duration-200",
                        dropdownOpen ? "opacity-100 visible translate-y-0" : "opacity-0 invisible pointer-events-none -translate-y-2"
                    )}
                >
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                        {[...markets].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).map(m => (
                            <button
                                type="button"
                                key={`${m.id}-${m.marketAddress}`}
                                onClick={() => {
                                    navigate(`/trade/${m.symbol}`);
                                    setDropdownOpen(false);
                                }}
                                className={clsx(
                                    "w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors border-b border-[var(--border-color)] last:border-0 focus:outline-none focus-visible:bg-[var(--bg-tertiary)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]/25",
                                    m.id === market.id && "bg-[var(--bg-tertiary)]"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <img src={m.image} alt={m.name} className="w-6 h-6 rounded-full" />
                                    <div className="flex flex-col items-start">
                                        <span className="text-sm font-bold text-text-primary">{m.symbol}</span>
                                        <span className="text-[11px] text-text-muted">{m.name}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                    <div className={clsx("text-sm font-bold tabular-nums", m.change24h >= 0 ? "text-[var(--long)]" : "text-[var(--short)]")}>
                                        {m.change24h >= 0 ? '+' : ''}{m.change24h?.toFixed(2)}%
                                    </div>
                                    <span className="text-[10px] text-text-muted tabular-nums">
                                        <span className="font-semibold text-text-secondary">Vol</span> ${((m.volume24h || 0) / 1_000_000).toFixed(1)}M
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right: Stats Row (Desktop) */}
            <div className="hidden md:flex items-center gap-1 rounded-xl bg-[var(--bg-tertiary)]/40 px-2 py-1.5 border border-[var(--border-color)]/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                {[
                    { label: 'Price', value: <PriceTicker value={currentPrice} prefix="$" decimals={2} className="text-text-primary font-semibold" />, valueClass: 'text-text-primary' },
                    { label: '24h Change', value: `${isPositive ? '+' : ''}${change24h.toFixed(2)}%`, valueClass: isPositive ? 'text-[var(--long)]' : 'text-[var(--short)]' },
                    { label: '24h Vol', value: formatCompact(market.volume24h ?? 0), valueClass: 'text-text-secondary' },
                    {
                        label: 'Funding / 1h',
                        value: (
                            <>
                                <span className={clsx(
                                    fundingRate > 0 ? "text-[var(--short)]" : (fundingRate < 0 ? "text-[var(--long)]" : "text-amber-400")
                                )}>
                                    {fundingRate > 0 ? '+' : ''}{((fundingRate * 100) / 8).toFixed(4)}%
                                </span>
                                <FundingCountdown />
                            </>
                        ),
                        valueClass: ''
                    },
                    { label: 'Open Interest', value: formatCompact(market.openInterest ?? 0), valueClass: 'text-text-secondary' },
                ].map((stat, i) => (
                    <StatItem
                        key={stat.label}
                        label={stat.label}
                        value={stat.value}
                        valueClass={stat.valueClass}
                        isFirst={i === 0}
                        isLast={i === 4}
                    />
                ))}
            </div>

            {/* Mobile Stats (Compact) */}
            <div className="flex md:hidden flex-col items-end gap-0 py-0.5">
                <div className="flex items-center">
                    <PriceTicker value={currentPrice} prefix="$" decimals={2} className="text-base font-bold font-mono text-text-primary tabular-nums" />
                </div>
                <span className={clsx("text-[11px] font-semibold tabular-nums leading-none", isPositive ? "text-[var(--long)]" : "text-[var(--short)]")}>
                    {isPositive ? '+' : ''}{change24h.toFixed(2)}%
                </span>
            </div>
        </div>
    );
}

function StatItem({
    label,
    value,
    valueClass = "text-text-primary",
    subValue,
    isFirst,
    isLast,
}: {
    label: string,
    value: React.ReactNode,
    valueClass?: string,
    subValue?: React.ReactNode,
    isFirst?: boolean,
    isLast?: boolean,
}) {
    return (
        <div className={clsx(
            "flex flex-col items-start px-4 py-1",
            !isFirst && "border-l border-[var(--border-color)]/60",
            !isLast && "pr-4"
        )}>
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted font-medium mb-1">{label}</span>
            <div className={clsx("flex flex-col gap-0.5 text-sm font-mono font-semibold tabular-nums leading-tight", valueClass)}>
                {value}
                {subValue}
            </div>
        </div>
    );
}
