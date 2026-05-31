import { Link, useLocation } from 'react-router-dom';
import {
    LayoutGrid,
    CandlestickChart,
    Wallet,
    Coins,
    Menu,
    PieChart,
    Trophy,
    Share2,
    Shield,
    Settings,
    X,
    Copy,
    BookOpen,
    Droplets,
    ChevronRight,
    ArrowUpRight,
    type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface MenuItem {
    name: string;
    path: string;
    icon: LucideIcon;
    desc: string;
}

interface MenuSection {
    label: string;
    items: MenuItem[];
}

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

function isLinkActive(path: string, currentPath: string) {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
}

export function MobileNav() {
    const location = useLocation();
    const [isMoreOpen, setIsMoreOpen] = useState(false);

    const navItems = [
        { name: 'Markets', path: '/', icon: LayoutGrid },
        { name: 'Trade', path: '/trade', icon: CandlestickChart, isPrimary: true },
        { name: 'Portfolio', path: '/portfolio', icon: Wallet },
        { name: 'Vault', path: '/vault', icon: Coins },
        { name: 'More', path: '#', icon: Menu, onClick: () => setIsMoreOpen((v) => !v) },
    ];

    // Close on route change and lock body scroll while the sheet is open.
    useEffect(() => {
        setIsMoreOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!isMoreOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isMoreOpen]);

    const moreActive = MENU_SECTIONS.some((s) => s.items.some((i) => isLinkActive(i.path, location.pathname)));

    return (
        <>
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 pb-safe pointer-events-none">
                <div className="mx-3 mb-2 pointer-events-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                    <div className="flex items-center justify-around h-[62px] px-2">
                        {navItems.map((item) => {
                            const isActive = item.path !== '#'
                                ? (item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path))
                                : false;

                            const Icon = item.icon;

                            if (item.onClick) {
                                const highlight = isMoreOpen || moreActive;
                                return (
                                    <button
                                        key={item.name}
                                        onClick={item.onClick}
                                        aria-expanded={isMoreOpen}
                                        aria-haspopup="menu"
                                        className={clsx(
                                            'flex flex-col items-center justify-center w-full h-full space-y-1 touch-manipulation rounded-xl transition-colors duration-200 motion-safe:active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                            highlight ? 'text-[var(--primary)]' : 'text-text-secondary active:text-text-primary',
                                        )}
                                    >
                                        <Icon className="w-5 h-5 transition-transform active:scale-95" />
                                        <span className="text-[10px] font-medium">{item.name}</span>
                                    </button>
                                );
                            }

                            return (
                                <Link
                                    key={item.name}
                                    to={item.path}
                                    className={clsx(
                                        'flex flex-col items-center justify-center w-full h-full space-y-1 relative touch-manipulation rounded-xl transition-colors duration-200 motion-safe:active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                        isActive ? 'text-[var(--primary)]' : 'text-text-secondary active:text-text-primary',
                                    )}
                                >
                                    {isActive && (
                                        <motion.div
                                            layoutId="mobile-nav-indicator"
                                            className="absolute -top-[1px] w-10 h-[2px] bg-[var(--primary)] rounded-full shadow-[0_0_8px_rgba(45,66,252,0.6)]"
                                        />
                                    )}
                                    <Icon className={clsx('w-5 h-5 transition-transform active:scale-95', isActive && 'text-[var(--primary)]')} />
                                    <span className="text-[10px] font-medium">{item.name}</span>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </nav>

            <AnimatePresence>
                {isMoreOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsMoreOpen(false)}
                            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
                            aria-hidden
                        />
                        <motion.div
                            role="menu"
                            aria-label="More navigation"
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
                            drag="y"
                            dragConstraints={{ top: 0, bottom: 0 }}
                            dragElastic={{ top: 0, bottom: 0.4 }}
                            onDragEnd={(_e, info) => {
                                if (info.offset.y > 120 || info.velocity.y > 600) setIsMoreOpen(false);
                            }}
                            className="lg:hidden fixed bottom-0 left-0 right-0 z-[61] rounded-t-3xl bg-[var(--bg-secondary)] border-t border-[var(--border-color)] shadow-[0_-12px_40px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh]"
                        >
                            {/* Grab handle */}
                            <div className="pt-3 pb-1 flex justify-center shrink-0 cursor-grab active:cursor-grabbing">
                                <span className="h-1.5 w-10 rounded-full bg-[var(--border-color-hover)]" aria-hidden />
                            </div>

                            {/* Header */}
                            <div className="px-5 pt-1 pb-3 flex items-center justify-between shrink-0">
                                <h2 className="text-base font-bold text-text-primary tracking-tight">More</h2>
                                <button
                                    onClick={() => setIsMoreOpen(false)}
                                    className="p-2 -mr-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                    aria-label="Close more menu"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Sections */}
                            <div className="px-3 pb-4 overflow-y-auto custom-scrollbar min-h-0 space-y-5">
                                {MENU_SECTIONS.map((section) => (
                                    <div key={section.label}>
                                        <div className="px-2 pb-1.5 text-[11px] uppercase tracking-[0.14em] text-text-muted font-semibold">
                                            {section.label}
                                        </div>
                                        <div className="space-y-1">
                                            {section.items.map((item) => {
                                                const active = isLinkActive(item.path, location.pathname);
                                                const Icon = item.icon;
                                                return (
                                                    <Link
                                                        key={item.path}
                                                        to={item.path}
                                                        role="menuitem"
                                                        onClick={() => setIsMoreOpen(false)}
                                                        className={clsx(
                                                            'flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors motion-safe:active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                                                            active ? 'bg-brand/10' : 'active:bg-[var(--bg-tertiary)]',
                                                        )}
                                                    >
                                                        <span
                                                            className={clsx(
                                                                'shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-colors',
                                                                active
                                                                    ? 'bg-brand/20 border-brand/30 text-[var(--primary)]'
                                                                    : 'bg-surface-3/70 border-line/70 text-text-secondary',
                                                            )}
                                                        >
                                                            <Icon className="w-5 h-5" />
                                                        </span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className={clsx('block text-sm font-semibold truncate', active ? 'text-[var(--primary)]' : 'text-text-primary')}>
                                                                {item.name}
                                                            </span>
                                                            <span className="block text-xs text-text-muted truncate">{item.desc}</span>
                                                        </span>
                                                        <ChevronRight className={clsx('w-4 h-4 shrink-0', active ? 'text-[var(--primary)]' : 'text-text-muted')} />
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}

                                {/* External links */}
                                <div className="grid grid-cols-2 gap-2 pt-1">
                                    {EXTERNAL_LINKS.map((link) => {
                                        const Icon = link.icon;
                                        return (
                                            <a
                                                key={link.href}
                                                href={link.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={() => setIsMoreOpen(false)}
                                                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-2xl bg-surface-3/70 border border-line/70 text-sm font-medium text-text-secondary active:bg-[var(--bg-tertiary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                            >
                                                <Icon className="w-4 h-4" />
                                                {link.name}
                                                <ArrowUpRight className="w-3.5 h-3.5 opacity-50" />
                                            </a>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Footer / version, padded for safe area */}
                            <div className="px-5 py-3 border-t border-[var(--border-color)] text-[11px] text-text-muted text-center pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0">
                                Realyx v1.0.0 · Testnet
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
