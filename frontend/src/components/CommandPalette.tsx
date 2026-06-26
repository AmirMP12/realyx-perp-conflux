import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Search,
    CornerDownLeft,
    LayoutGrid,
    CandlestickChart,
    Wallet,
    Coins,
    Shield,
    Trophy,
    Copy,
    Share2,
    PieChart,
    Settings,
    Activity,
    type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useMarketsStore } from '../stores';
import { applyMarketDisplayFallback } from '../utils/market';
import { MarketLogo } from './MarketLogo';

interface NavCommand {
    kind: 'nav';
    id: string;
    name: string;
    desc: string;
    path: string;
    icon: LucideIcon;
    keywords?: string;
}

interface MarketCommand {
    kind: 'market';
    id: string;
    symbol: string;
    name: string;
    image?: string;
    change24h: number;
    path: string;
}

type Command = NavCommand | MarketCommand;

const NAV_COMMANDS: NavCommand[] = [
    { kind: 'nav', id: 'nav-markets', name: 'Markets', desc: 'Browse all markets', path: '/', icon: LayoutGrid, keywords: 'home overview' },
    { kind: 'nav', id: 'nav-trade', name: 'Trade', desc: 'Open the trading terminal', path: '/trade', icon: CandlestickChart, keywords: 'perp perpetual chart order' },
    { kind: 'nav', id: 'nav-portfolio', name: 'Portfolio', desc: 'Your positions and balances', path: '/portfolio', icon: Wallet, keywords: 'positions account balance' },
    { kind: 'nav', id: 'nav-vault', name: 'Vault', desc: 'Provide liquidity, earn fees', path: '/vault', icon: Coins, keywords: 'liquidity lp yield earn' },
    { kind: 'nav', id: 'nav-insurance', name: 'Insurance', desc: 'Stake to backstop bad debt', path: '/insurance', icon: Shield, keywords: 'stake backstop safety' },
    { kind: 'nav', id: 'nav-leaderboard', name: 'Leaderboard', desc: 'Top traders by PnL', path: '/leaderboard', icon: Trophy, keywords: 'ranking top traders' },
    { kind: 'nav', id: 'nav-copy', name: 'Copy Trading', desc: 'Mirror lead traders', path: '/copy-trading', icon: Copy, keywords: 'mirror follow social' },
    { kind: 'nav', id: 'nav-referrals', name: 'Referrals', desc: 'Invite and earn rebates', path: '/referrals', icon: Share2, keywords: 'invite rebate affiliate' },
    { kind: 'nav', id: 'nav-analytics', name: 'Analytics', desc: 'Protocol-wide metrics', path: '/analytics', icon: PieChart, keywords: 'stats metrics dashboard' },
    { kind: 'nav', id: 'nav-status', name: 'Status', desc: 'Uptime, oracle & solvency', path: '/status', icon: Activity, keywords: 'uptime health solvency oracle' },
    { kind: 'nav', id: 'nav-settings', name: 'Settings', desc: 'Preferences and account', path: '/settings', icon: Settings, keywords: 'preferences theme config' },
];

function matches(query: string, ...fields: (string | undefined)[]): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = fields.filter(Boolean).join(' ').toLowerCase();
    // Lightweight subsequence/substring match: every whitespace-separated
    // token in the query must appear somewhere in the haystack.
    return q.split(/\s+/).every((tok) => hay.includes(tok));
}

/**
 * Global Cmd-K (Ctrl-K) command palette. Power-user affordance for instantly
 * jumping to any market or page without hunting through the nav. Opens on the
 * keyboard shortcut, supports arrow-key navigation, Enter to go, Esc to close.
 */
export function CommandPalette() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const rawMarkets = useMarketsStore((s) => s.markets);
    const markets = useMemo(
        () => rawMarkets.map(applyMarketDisplayFallback),
        [rawMarkets],
    );

    const marketCommands = useMemo<MarketCommand[]>(
        () =>
            [...markets]
                .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
                .map((m) => ({
                    kind: 'market' as const,
                    id: `market-${m.id}-${m.marketAddress}`,
                    symbol: m.symbol,
                    name: m.name,
                    image: m.image,
                    change24h: m.change24h ?? 0,
                    path: `/trade/${m.symbol}`,
                })),
        [markets],
    );

    const filteredNav = useMemo(
        () => NAV_COMMANDS.filter((c) => matches(query, c.name, c.desc, c.keywords)),
        [query],
    );
    const filteredMarkets = useMemo(
        () => marketCommands.filter((c) => matches(query, c.symbol, c.name)),
        [marketCommands, query],
    );

    // Flat, ordered list used for keyboard navigation. Markets first when the
    // user is searching (they're the common target), nav pages otherwise.
    const flat = useMemo<Command[]>(() => {
        if (query.trim()) return [...filteredMarkets, ...filteredNav];
        return [...filteredNav, ...filteredMarkets];
    }, [query, filteredMarkets, filteredNav]);

    const close = useCallback(() => {
        setOpen(false);
        setQuery('');
        setActiveIndex(0);
    }, []);

    const run = useCallback(
        (cmd: Command | undefined) => {
            if (!cmd) return;
            navigate(cmd.path);
            close();
        },
        [navigate, close],
    );

    // Global shortcut: Cmd/Ctrl+K toggles the palette. A custom event lets
    // other UI (e.g. the navbar search button) open it without prop-drilling.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen((v) => !v);
            }
        }
        function onOpen() {
            setOpen(true);
        }
        window.addEventListener('keydown', onKey);
        window.addEventListener('realyx:open-command-palette', onOpen);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('realyx:open-command-palette', onOpen);
        };
    }, []);

    // Focus the input and reset selection whenever the palette opens.
    useEffect(() => {
        if (open) {
            setActiveIndex(0);
            // Defer so the element is mounted before focusing.
            const t = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [open]);

    // Keep the active index in range as the result set shrinks/grows.
    useEffect(() => {
        setActiveIndex((i) => Math.min(i, Math.max(0, flat.length - 1)));
    }, [flat.length]);

    const onListKey = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            run(flat[activeIndex]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    };

    // Scroll the active row into view on keyboard navigation.
    useEffect(() => {
        if (!open) return;
        const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex, open]);

    if (typeof document === 'undefined') return null;

    // Index offset so the second-rendered group continues the flat indexing.
    const searching = !!query.trim();
    const marketsOffset = searching ? 0 : filteredNav.length;
    const navOffset = searching ? filteredMarkets.length : 0;

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[12vh] bg-black/60 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    onMouseDown={close}
                    role="presentation"
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: -8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -8 }}
                        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onKeyDown={onListKey}
                        className="w-full max-w-[600px] rounded-2xl border border-[var(--border-color)] bg-surface-2/95 backdrop-blur-xl shadow-[0_24px_60px_rgba(0,0,0,0.55)] overflow-hidden"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Command palette"
                    >
                        {/* Search input */}
                        <div className="flex items-center gap-3 px-4 border-b border-[var(--border-color)]">
                            <Search className="w-4 h-4 text-text-muted shrink-0" />
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search markets and pages…"
                                className="flex-1 bg-transparent py-4 text-sm text-text-primary placeholder-text-muted outline-none"
                                role="combobox"
                                aria-expanded="true"
                                aria-controls="command-palette-list"
                                aria-activedescendant={flat[activeIndex]?.id}
                            />
                            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-line/70 bg-surface-3/60 text-[10px] font-medium text-text-muted">
                                ESC
                            </kbd>
                        </div>

                        {/* Results */}
                        <div
                            ref={listRef}
                            id="command-palette-list"
                            role="listbox"
                            className="max-h-[min(420px,60vh)] overflow-y-auto custom-scrollbar py-2"
                        >
                            {flat.length === 0 ? (
                                <div className="px-4 py-10 text-center text-sm text-text-muted">
                                    No results for “{query}”
                                </div>
                            ) : (
                                <>
                                    {searching && filteredMarkets.length > 0 && (
                                        <Group label="Markets">
                                            {filteredMarkets.map((c, i) => (
                                                <MarketRow
                                                    key={c.id}
                                                    cmd={c}
                                                    index={marketsOffset + i}
                                                    active={activeIndex === marketsOffset + i}
                                                    onHover={setActiveIndex}
                                                    onSelect={run}
                                                />
                                            ))}
                                        </Group>
                                    )}

                                    <Group label="Go to">
                                        {filteredNav.map((c, i) => (
                                            <NavRow
                                                key={c.id}
                                                cmd={c}
                                                index={navOffset + i}
                                                active={activeIndex === navOffset + i}
                                                onHover={setActiveIndex}
                                                onSelect={run}
                                            />
                                        ))}
                                    </Group>

                                    {!searching && filteredMarkets.length > 0 && (
                                        <Group label="Markets">
                                            {filteredMarkets.map((c, i) => (
                                                <MarketRow
                                                    key={c.id}
                                                    cmd={c}
                                                    index={filteredNav.length + i}
                                                    active={activeIndex === filteredNav.length + i}
                                                    onHover={setActiveIndex}
                                                    onSelect={run}
                                                />
                                            ))}
                                        </Group>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer hint */}
                        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-[var(--border-color)] bg-surface-3/30 text-[11px] text-text-muted">
                            <span className="inline-flex items-center gap-1">
                                <kbd className="px-1 py-0.5 rounded border border-line/70 bg-surface-3/60">↑</kbd>
                                <kbd className="px-1 py-0.5 rounded border border-line/70 bg-surface-3/60">↓</kbd>
                                navigate
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <kbd className="px-1 py-0.5 rounded border border-line/70 bg-surface-3/60">
                                    <CornerDownLeft className="w-2.5 h-2.5" />
                                </kbd>
                                select
                            </span>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="px-2 pb-1">
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold">
                {label}
            </div>
            <div className="space-y-0.5">{children}</div>
        </div>
    );
}

interface RowProps<T> {
    cmd: T;
    index: number;
    active: boolean;
    onHover: (i: number) => void;
    onSelect: (cmd: T) => void;
}

function NavRow({ cmd, index, active, onHover, onSelect }: RowProps<NavCommand>) {
    const Icon = cmd.icon;
    return (
        <button
            type="button"
            id={cmd.id}
            data-cmd-index={index}
            role="option"
            aria-selected={active}
            onMouseMove={() => onHover(index)}
            onClick={() => onSelect(cmd)}
            className={clsx(
                'w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
                active ? 'bg-brand/15' : 'hover:bg-[var(--bg-tertiary)]',
            )}
        >
            <span
                className={clsx(
                    'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border',
                    active ? 'bg-brand/20 border-brand/30 text-[var(--primary)]' : 'bg-surface-3/60 border-line/70 text-text-secondary',
                )}
            >
                <Icon className="w-4 h-4" />
            </span>
            <span className="min-w-0 flex-1">
                <span className={clsx('block text-sm font-medium truncate', active ? 'text-text-primary' : 'text-text-primary')}>
                    {cmd.name}
                </span>
                <span className="block text-xs text-text-muted truncate">{cmd.desc}</span>
            </span>
        </button>
    );
}

function MarketRow({ cmd, index, active, onHover, onSelect }: RowProps<MarketCommand>) {
    const positive = cmd.change24h >= 0;
    return (
        <button
            type="button"
            id={cmd.id}
            data-cmd-index={index}
            role="option"
            aria-selected={active}
            onMouseMove={() => onHover(index)}
            onClick={() => onSelect(cmd)}
            className={clsx(
                'w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
                active ? 'bg-brand/15' : 'hover:bg-[var(--bg-tertiary)]',
            )}
        >
            <MarketLogo src={cmd.image} symbol={cmd.symbol} name={cmd.name} size="md" className="rounded-full shrink-0" />
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-text-primary truncate">{cmd.symbol}</span>
                <span className="block text-xs text-text-muted truncate">{cmd.name}</span>
            </span>
            <span className={clsx('text-sm font-semibold tabular-nums shrink-0', positive ? 'text-[var(--long)]' : 'text-[var(--short)]')}>
                {positive ? '+' : ''}{cmd.change24h.toFixed(2)}%
            </span>
        </button>
    );
}

export default CommandPalette;
