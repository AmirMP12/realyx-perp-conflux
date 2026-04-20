import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function MobileNav() {
    const location = useLocation();
    const [isMoreOpen, setIsMoreOpen] = useState(false);

    const navItems = [
        { name: 'Markets', path: '/', icon: LayoutGrid },
        { name: 'Trade', path: '/trade', icon: CandlestickChart, isPrimary: true },
        { name: 'Portfolio', path: '/portfolio', icon: Wallet },
        { name: 'Vault', path: '/vault', icon: Coins }, // Vault + Insurance could be under Earn
        { name: 'More', path: '#', icon: Menu, onClick: () => setIsMoreOpen(!isMoreOpen) },
    ];

    return (
        <>
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 pb-safe pointer-events-none">
                <div className="mx-3 mb-2 pointer-events-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                    <div className="flex items-center justify-around h-[62px] px-2">
                    {navItems.map((item) => {
                        const isActive = item.path !== '#' && (
                            item.path === '/'
                                ? location.pathname === '/'
                                : location.pathname.startsWith(item.path)
                        );

                        const Icon = item.icon;

                        if (item.onClick) {
                            return (
                                <button
                                    key={item.name}
                                    onClick={item.onClick}
                                    className={clsx(
                                        "flex flex-col items-center justify-center w-full h-full space-y-1 touch-manipulation rounded-xl transition-colors duration-200 motion-safe:active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40",
                                        isMoreOpen ? "text-[var(--primary)]" : "text-text-secondary active:text-text-primary"
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
                                    "flex flex-col items-center justify-center w-full h-full space-y-1 relative touch-manipulation rounded-xl transition-colors duration-200 motion-safe:active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40",
                                    isActive ? "text-[var(--primary)]" : "text-text-secondary active:text-text-primary"
                                )}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="mobile-nav-indicator"
                                        className="absolute -top-[1px] w-10 h-[2px] bg-[var(--primary)] rounded-full shadow-[0_0_8px_rgba(45,66,252,0.6)]"
                                    />
                                )}
                                <Icon className={clsx("w-5 h-5 transition-transform active:scale-95", isActive && "text-[var(--primary)]")} />
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
                            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                        />
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="lg:hidden fixed bottom-[74px] left-0 right-0 mx-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] z-50 overflow-hidden pb-5 shadow-2xl max-h-[min(70vh,420px)] flex flex-col"
                        >
                            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                                    <Sparkles className="w-4 h-4 text-[var(--primary)]" />
                                    More
                                </div>
                                <button
                                    onClick={() => setIsMoreOpen(false)}
                                    className="p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                                    aria-label="Close more menu"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="p-4 grid grid-cols-2 gap-3 overflow-y-auto custom-scrollbar min-h-0">
                                <Link to="/analytics" onClick={() => setIsMoreOpen(false)} className="p-4 bg-[var(--bg-tertiary)]/70 rounded-xl border border-[var(--border-color)]/80 hover:bg-[var(--bg-tertiary)] transition-colors motion-safe:active:scale-[0.98] flex flex-col items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40">
                                    <BarChart2 className="w-6 h-6 text-text-secondary" />
                                    <span className="text-sm font-medium text-text-primary">Analytics</span>
                                </Link>
                                <Link to="/leaderboard" onClick={() => setIsMoreOpen(false)} className="p-4 bg-[var(--bg-tertiary)]/70 rounded-xl border border-[var(--border-color)]/80 hover:bg-[var(--bg-tertiary)] transition-colors motion-safe:active:scale-[0.98] flex flex-col items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40">
                                    <Trophy className="w-6 h-6 text-text-secondary" />
                                    <span className="text-sm font-medium text-text-primary">Leaderboard</span>
                                </Link>
                                <Link to="/referrals" onClick={() => setIsMoreOpen(false)} className="p-4 bg-[var(--bg-tertiary)]/70 rounded-xl border border-[var(--border-color)]/80 hover:bg-[var(--bg-tertiary)] transition-colors motion-safe:active:scale-[0.98] flex flex-col items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40">
                                    <Share2 className="w-6 h-6 text-text-secondary" />
                                    <span className="text-sm font-medium text-text-primary">Referrals</span>
                                </Link>
                                <Link to="/insurance" onClick={() => setIsMoreOpen(false)} className="p-4 bg-[var(--bg-tertiary)]/70 rounded-xl border border-[var(--border-color)]/80 hover:bg-[var(--bg-tertiary)] transition-colors motion-safe:active:scale-[0.98] flex flex-col items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40">
                                    <Shield className="w-6 h-6 text-text-secondary" />
                                    <span className="text-sm font-medium text-text-primary">Insurance</span>
                                </Link>
                                <Link to="/settings" onClick={() => setIsMoreOpen(false)} className="p-4 bg-[var(--bg-tertiary)]/70 rounded-xl border border-[var(--border-color)]/80 hover:bg-[var(--bg-tertiary)] transition-colors motion-safe:active:scale-[0.98] flex flex-col items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40">
                                    <Settings className="w-6 h-6 text-text-secondary" />
                                    <span className="text-sm font-medium text-text-primary">Settings</span>
                                </Link>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
