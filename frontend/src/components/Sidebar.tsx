import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LayoutGrid,
    LineChart,
    TrendingUp,
    Wallet,
    Settings,
    ExternalLink,
    HelpCircle,
    Shield,
    PieChart,
    Trophy,
    Share2,
    X
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
    { path: '/', icon: LayoutGrid, label: 'Markets' },
    { path: '/trade', icon: LineChart, label: 'Trade' },
    { path: '/portfolio', icon: Wallet, label: 'Portfolio' },
    { path: '/vault', icon: TrendingUp, label: 'Vault' },
    { path: '/insurance', icon: Shield, label: 'Insurance' },
    { path: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { path: '/referrals', icon: Share2, label: 'Referrals' },
    { path: '/analytics', icon: PieChart, label: 'Analytics' },
];

const bottomItems = [
    { path: '/settings', icon: Settings, label: 'Settings' },
    { href: 'https://efaucet.confluxnetwork.org/', icon: ExternalLink, label: 'Faucet', external: true },
    { href: 'https://realyx.xyz/docs', icon: HelpCircle, label: 'Docs', external: true },
];

interface SidebarProps {
    isMobileOpen: boolean;
    onClose: () => void;
}

export function Sidebar({ isMobileOpen, onClose }: SidebarProps) {
    const location = useLocation();

    return (
        <AnimatePresence>
            {isMobileOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                        onClick={onClose}
                    />

                    {/* Drawer */}
                    <motion.aside
                        initial={{ x: '-100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '-100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="fixed left-0 top-0 bottom-0 w-[85vw] max-w-[300px] border-r border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col z-50 lg:hidden shadow-2xl"
                    >
                        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
                            <span className="font-display font-bold text-lg text-white">Menu</span>
                            <button
                                type="button"
                                onClick={onClose}
                                className="p-2 -mr-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                                aria-label="Close menu"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto py-4 px-3">
                            <nav className="space-y-1">
                                {navItems.map((item) => {
                                    const isActive = location.pathname === item.path ||
                                        (item.path !== '/' && location.pathname.startsWith(item.path));

                                    return (
                                        <Link key={item.path} to={item.path} onClick={onClose}>
                                            <div
                                                className={clsx(
                                                    'flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors focus-within:ring-2 focus-within:ring-[var(--primary)]/40',
                                                    isActive
                                                        ? 'bg-[var(--primary)] text-white'
                                                        : 'text-text-secondary hover:text-white hover:bg-[var(--bg-tertiary)]'
                                                )}
                                            >
                                                <item.icon className="w-5 h-5 shrink-0" />
                                                <span className="font-medium">{item.label}</span>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="border-t border-[var(--border-color)] py-4 px-3">
                            <nav className="space-y-1">
                                {bottomItems.map((item) => (
                                    item.external ? (
                                        <a
                                            key={item.href}
                                            href={item.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center space-x-3 px-4 py-3 rounded-xl text-text-secondary hover:text-white hover:bg-[var(--bg-tertiary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                                            onClick={onClose}
                                        >
                                            <item.icon className="w-5 h-5" />
                                            <span className="font-medium">{item.label}</span>
                                            <ExternalLink className="w-4 h-4 ml-auto opacity-50" />
                                        </a>
                                    ) : (
                                        <Link
                                            key={item.path}
                                            to={item.path!}
                                            onClick={onClose}
                                            className={clsx(
                                                'flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors focus-within:ring-2 focus-within:ring-[var(--primary)]/40',
                                                location.pathname === item.path
                                                    ? 'bg-[var(--bg-tertiary)] text-white'
                                                    : 'text-text-secondary hover:text-white hover:bg-[var(--bg-tertiary)]'
                                            )}
                                        >
                                            <item.icon className="w-5 h-5" />
                                            <span className="font-medium">{item.label}</span>
                                        </Link>
                                    )
                                ))}
                            </nav>
                            <div className="mt-4 px-4 text-xs text-text-muted">
                                v1.0.0 • Devnet
                            </div>
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}
