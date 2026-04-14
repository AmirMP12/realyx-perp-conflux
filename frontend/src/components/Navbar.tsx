import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { WalletConnectButton } from './WalletConnect';
import { ProtocolStatsBar } from './ProtocolStatsBar';
import { NetworkIndicator } from './NetworkIndicator';
import clsx from 'clsx';

const PRIMARY_LINKS = [
    { name: 'Markets', path: '/' },
    { name: 'Trade', path: '/trade' },
    { name: 'Portfolio', path: '/portfolio' },
];

const MORE_LINKS = [
    { name: 'Vault', path: '/vault' },
    { name: 'Insurance', path: '/insurance' },
    { name: 'Leaderboard', path: '/leaderboard' },
    { name: 'Referrals', path: '/referrals' },
    { name: 'Analytics', path: '/analytics' },
    { name: 'Settings', path: '/settings' },
];

function isLinkActive(path: string, currentPath: string) {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
}

export function Navbar() {
    const location = useLocation();
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <nav className="h-16 border-b border-[var(--border-color)]/80 bg-[var(--bg-secondary)]/95 backdrop-blur-md sticky top-0 z-50">
            <div className="h-full max-w-[1920px] mx-auto flex items-center justify-between gap-2 sm:gap-4 lg:gap-6 px-3 sm:px-4 lg:px-6 min-w-0">
                {/* Left: Logo */}
                <Link to="/" className="flex items-center gap-2 shrink-0 group">
                    <div className="w-9 h-9 rounded-xl overflow-hidden border border-[var(--border-color)]/80 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                        <img src="/tr.png" alt="Realyx" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </div>
                    <span className="font-display font-bold text-lg tracking-tight group-hover:opacity-90 transition-opacity">
                        <span className="text-white">Real</span><span className="text-[var(--primary)]">yx</span>
                    </span>
                </Link>

                {/* Center: Desktop Nav - separated from logo and actions */}
                <div className="hidden lg:flex items-center min-w-0 flex-1 justify-center">
                    <div className="flex items-center rounded-xl bg-[var(--bg-tertiary)]/40 border border-[var(--border-color)]/70 p-1 gap-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                        {PRIMARY_LINKS.map((link) => {
                            const active = isLinkActive(link.path, location.pathname);
                            return (
                                <Link
                                    key={link.path}
                                    to={link.path}
                                    className={clsx(
                                        'h-9 px-4 inline-flex items-center rounded-lg text-sm font-medium transition-all duration-300 ease-out active:scale-[0.98]',
                                        active
                                            ? 'text-white bg-[var(--primary)]/20 shadow-[0_0_0_1px_rgba(45,66,252,0.2)]'
                                            : 'text-text-secondary hover:text-white hover:bg-white/5'
                                    )}
                                >
                                    {link.name}
                                </Link>
                            );
                        })}
                        <div className="relative" ref={moreRef}>
                            <button
                                onClick={() => setMoreOpen(!moreOpen)}
                                className={clsx(
                                    'h-9 flex items-center gap-1 px-4 rounded-lg text-sm font-medium transition-all duration-300 ease-out active:scale-[0.98]',
                                    MORE_LINKS.some(l => isLinkActive(l.path, location.pathname))
                                        ? 'text-white bg-[var(--primary)]/20 shadow-[0_0_0_1px_rgba(45,66,252,0.2)]'
                                        : 'text-text-secondary hover:text-white hover:bg-white/5'
                                )}
                            >
                                More
                                <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', moreOpen && 'rotate-180')} />
                            </button>
                            {moreOpen && (
                                <div className="absolute top-full left-0 mt-2 py-2 min-w-[220px] rounded-xl bg-[var(--bg-secondary)]/95 backdrop-blur-md border border-[var(--border-color)] shadow-2xl z-50">
                                    <div className="px-3 pb-2 text-[11px] uppercase tracking-[0.12em] text-text-muted">Explore</div>
                                    {MORE_LINKS.map((link) => {
                                        const active = isLinkActive(link.path, location.pathname);
                                        return (
                                            <Link
                                                key={link.path}
                                                to={link.path}
                                                onClick={() => setMoreOpen(false)}
                                                className={clsx(
                                                    'mx-2 block px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 active:scale-[0.99]',
                                                    active ? 'text-[var(--primary)] bg-[var(--primary)]/10' : 'text-text-secondary hover:text-white hover:bg-white/5'
                                                )}
                                            >
                                                {link.name}
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right: Actions - distinct from nav */}
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
