import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ExternalLink } from 'lucide-react';
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
        <nav className="h-14 lg:h-16 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] sticky top-0 z-50">
            <div className="h-full max-w-[1920px] mx-auto flex items-center justify-between gap-2 sm:gap-4 lg:gap-6 px-3 sm:px-4 lg:px-6 min-w-0">
                {/* Left: Logo */}
                <Link to="/" className="flex items-center gap-2 shrink-0 group">
                    <div className="w-8 h-8 lg:w-9 lg:h-9 rounded-lg overflow-hidden border border-[var(--border-color)]">
                        <img src="/tr.png" alt="Realyx" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </div>
                    <span className="font-display font-bold text-lg lg:text-xl tracking-tight group-hover:opacity-90 transition-opacity">
                        <span className="text-white">Real</span><span className="text-[var(--primary)]">yx</span>
                    </span>
                </Link>

                {/* Center: Desktop Nav - separated from logo and actions */}
                <div className="hidden lg:flex items-center min-w-0 flex-1 justify-center">
                    <div className="flex items-center rounded-lg bg-[var(--bg-tertiary)]/50 border border-[var(--border-color)]/50 p-1 gap-0.5">
                        {PRIMARY_LINKS.map((link) => {
                            const active = isLinkActive(link.path, location.pathname);
                            return (
                                <Link
                                    key={link.path}
                                    to={link.path}
                                    className={clsx(
                                        'px-4 py-2 rounded-md text-sm font-medium transition-all duration-200',
                                        active
                                            ? 'text-white bg-[var(--primary)]/20'
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
                                    'flex items-center gap-1 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200',
                                    MORE_LINKS.some(l => isLinkActive(l.path, location.pathname))
                                        ? 'text-white bg-[var(--primary)]/20'
                                        : 'text-text-secondary hover:text-white hover:bg-white/5'
                                )}
                            >
                                More
                                <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', moreOpen && 'rotate-180')} />
                            </button>
                            {moreOpen && (
                                <div className="absolute top-full left-0 mt-1 py-2 min-w-[160px] rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-xl z-50">
                                    {MORE_LINKS.map((link) => {
                                        const active = isLinkActive(link.path, location.pathname);
                                        return (
                                            <Link
                                                key={link.path}
                                                to={link.path}
                                                onClick={() => setMoreOpen(false)}
                                                className={clsx(
                                                    'block px-4 py-2.5 text-sm font-medium transition-colors',
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
                    <a
                        href="https://efaucet.confluxnetwork.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[var(--border-color-hover)] transition-colors"
                    >
                        <span className="text-xs font-medium text-text-secondary">Faucet</span>
                        <ExternalLink className="w-3 h-3 text-text-secondary" />
                    </a>
                    <div className="[&_button]:!text-xs [&_button]:!py-1.5 [&_button]:!px-3 sm:[&_button]:!text-sm sm:[&_button]:!py-2 sm:[&_button]:!px-4">
                        <WalletConnectButton />
                    </div>
                </div>
            </div>
        </nav>
    );
}
