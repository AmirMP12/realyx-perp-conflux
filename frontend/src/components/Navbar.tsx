import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ChevronDown,
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
    BookOpen,
    Droplets,
    ArrowUpRight,
    type LucideIcon,
} from 'lucide-react';
import { WalletConnectButton } from './WalletConnect';
import { ProtocolStatsBar } from './ProtocolStatsBar';
import { NetworkIndicator } from './NetworkIndicator';
import clsx from 'clsx';

interface NavLinkDef {
    name: string;
    path: string;
    icon: LucideIcon;
}

interface MenuSection {
    label: string;
    items: { name: string; path: string; icon: LucideIcon; desc: string }[];
}

const PRIMARY_LINKS: NavLinkDef[] = [
    { name: 'Markets', path: '/', icon: LayoutGrid },
    { name: 'Trade', path: '/trade', icon: CandlestickChart },
    { name: 'Portfolio', path: '/portfolio', icon: Wallet },
];

const MENU_SECTIONS: MenuSection[] = [
    {
        label: 'Earn',
        items: [
            { name: 'Vault', path: '/vault', icon: Coins, desc: 'Provide liquidity, earn fees' },
            { name: 'Insurance', path: '/insurance', icon: Shield, desc: 'Stake to backstop bad debt' },
        ],
    },
    {
        label: 'Social',
        items: [
            { name: 'Leaderboard', path: '/leaderboard', icon: Trophy, desc: 'Top traders by PnL' },
            { name: 'Copy Trading', path: '/copy-trading', icon: Copy, desc: 'Mirror lead traders' },
            { name: 'Referrals', path: '/referrals', icon: Share2, desc: 'Invite and earn rebates' },
        ],
    },
    {
        label: 'More',
        items: [
            { name: 'Analytics', path: '/analytics', icon: PieChart, desc: 'Protocol-wide metrics' },
            { name: 'Settings', path: '/settings', icon: Settings, desc: 'Preferences and account' },
        ],
    },
];

const EXTERNAL_LINKS = [
    { name: 'Docs', href: 'https://docs-realyx.vercel.app', icon: BookOpen },
    { name: 'Faucet', href: 'https://efaucet.confluxnetwork.org/', icon: Droplets },
];

const MORE_PATHS = MENU_SECTIONS.flatMap((s) => s.items.map((i) => i.path));

function isLinkActive(path: string, currentPath: string) {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
}

export function Navbar() {
    const location = useLocation();
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);

    // Close the mega-menu on outside click and on Escape.
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setMoreOpen(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKey);
        };
    }, []);

    // Auto-close when the route changes (e.g. selecting a menu item).
    useEffect(() => {
        setMoreOpen(false);
    }, [location.pathname]);

    const moreActive = MORE_PATHS.some((p) => isLinkActive(p, location.pathname));

    return (
        <nav className="h-16 sticky top-0 z-50 border-b border-line/70 bg-surface-2/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface-2/70 shadow-[0_1px_0_rgba(0,0,0,0.25)]">
            {/* Accent hairline for depth */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand/30 to-transparent" aria-hidden />

            <div className="h-full max-w-[1920px] mx-auto flex items-center justify-between gap-2 sm:gap-4 lg:gap-6 px-3 sm:px-4 lg:px-6 min-w-0">
                {/* Left: Logo */}
                <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
                    <div className="relative w-9 h-9 rounded-xl overflow-hidden border border-line/80 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                        <img src="/tr.png" alt="Realyx" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-xl" aria-hidden />
                    </div>
                    <span className="font-display font-bold text-lg tracking-tight group-hover:opacity-90 transition-opacity">
                        <span className="text-[var(--text-primary)]">Real</span><span className="text-[var(--primary)]">yx</span>
                    </span>
                </Link>

                {/* Center: Desktop Nav */}
                <div className="hidden lg:flex items-center min-w-0 flex-1 justify-center">
                    <div className="flex items-center rounded-2xl bg-surface-3/40 border border-line/60 p-1 gap-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                        {PRIMARY_LINKS.map((link) => {
                            const active = isLinkActive(link.path, location.pathname);
                            const Icon = link.icon;
                            return (
                                <Link
                                    key={link.path}
                                    to={link.path}
                                    aria-current={active ? 'page' : undefined}
                                    className={clsx(
                                        'relative h-9 px-3.5 inline-flex items-center gap-2 rounded-xl text-sm font-medium transition-colors duration-200 ease-out motion-safe:active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                        active ? 'text-white' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3/70'
                                    )}
                                >
                                    {active && (
                                        <motion.span
                                            layoutId="nav-active-pill"
                                            className="absolute inset-0 rounded-xl bg-brand shadow-[0_2px_12px_rgba(45,66,252,0.45)]"
                                            transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                                        />
                                    )}
                                    <Icon className="relative z-10 w-4 h-4" />
                                    <span className="relative z-10">{link.name}</span>
                                </Link>
                            );
                        })}

                        {/* More mega-menu */}
                        <div className="relative" ref={moreRef}>
                            <button
                                type="button"
                                onClick={() => setMoreOpen((v) => !v)}
                                aria-expanded={moreOpen}
                                aria-haspopup="menu"
                                className={clsx(
                                    'relative h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl text-sm font-medium transition-colors duration-200 ease-out motion-safe:active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                    moreActive || moreOpen ? 'text-white' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3/70'
                                )}
                            >
                                {moreActive && (
                                    <motion.span
                                        layoutId="nav-active-pill"
                                        className="absolute inset-0 rounded-xl bg-brand shadow-[0_2px_12px_rgba(45,66,252,0.45)]"
                                        transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                                    />
                                )}
                                <span className="relative z-10">More</span>
                                <ChevronDown className={clsx('relative z-10 w-3.5 h-3.5 transition-transform duration-200', moreOpen && 'rotate-180')} />
                            </button>

                            <AnimatePresence>
                                {moreOpen && (
                                    <motion.div
                                        role="menu"
                                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                                        className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-[var(--border-color)] bg-surface-2/95 backdrop-blur-xl shadow-[0_24px_60px_rgba(0,0,0,0.5)] overflow-hidden z-[100]"
                                    >
                                        <div className="grid grid-cols-2 gap-x-2 gap-y-4 p-4">
                                            {MENU_SECTIONS.map((section) => (
                                                <div key={section.label} className="min-w-0">
                                                    <div className="px-2 pb-1.5 text-[11px] uppercase tracking-[0.14em] text-text-muted font-semibold">
                                                        {section.label}
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        {section.items.map((item) => {
                                                            const active = isLinkActive(item.path, location.pathname);
                                                            const Icon = item.icon;
                                                            return (
                                                                <Link
                                                                    key={item.path}
                                                                    to={item.path}
                                                                    role="menuitem"
                                                                    onClick={() => setMoreOpen(false)}
                                                                    className={clsx(
                                                                        'group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                                                        active ? 'bg-brand/10' : 'hover:bg-[var(--bg-tertiary)]'
                                                                    )}
                                                                >
                                                                    <span
                                                                        className={clsx(
                                                                            'shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border transition-colors',
                                                                            active
                                                                                ? 'bg-brand/20 border-brand/30 text-[var(--primary)]'
                                                                                : 'bg-surface-3/60 border-line/70 text-text-secondary group-hover:text-text-primary'
                                                                        )}
                                                                    >
                                                                        <Icon className="w-4 h-4" />
                                                                    </span>
                                                                    <span className="min-w-0">
                                                                        <span className={clsx('block text-sm font-medium truncate', active ? 'text-[var(--primary)]' : 'text-text-primary')}>
                                                                            {item.name}
                                                                        </span>
                                                                        <span className="block text-xs text-text-muted truncate">{item.desc}</span>
                                                                    </span>
                                                                </Link>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Footer: external links */}
                                        <div className="flex items-center gap-1 border-t border-[var(--border-color)] bg-surface-3/30 px-3 py-2.5">
                                            {EXTERNAL_LINKS.map((link) => {
                                                const Icon = link.icon;
                                                return (
                                                    <a
                                                        key={link.href}
                                                        href={link.href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={() => setMoreOpen(false)}
                                                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                                    >
                                                        <Icon className="w-3.5 h-3.5" />
                                                        {link.name}
                                                        <ArrowUpRight className="w-3 h-3 opacity-50" />
                                                    </a>
                                                );
                                            })}
                                            <span className="ml-auto text-[11px] text-text-muted pr-1">v1.0.0 · Testnet</span>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0 overflow-hidden">
                    <ProtocolStatsBar />
                    <div className="hidden xl:block h-6 w-px bg-[var(--border-color)]" aria-hidden />
                    <NetworkIndicator />
                    <div className="[&_button]:!h-9 [&_button]:!min-h-0 [&_button]:!px-3 sm:[&_button]:!px-4 [&_button]:!text-xs sm:[&_button]:!text-sm [&_button]:!rounded-lg">
                        <WalletConnectButton />
                    </div>
                </div>
            </div>
        </nav>
    );
}
