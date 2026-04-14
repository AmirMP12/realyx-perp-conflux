import { useState } from 'react';
import { useAccount } from 'wagmi';
import { motion, AnimatePresence } from 'framer-motion';
import {
    TrendingUp, Lock, DollarSign,
    PieChart, Loader2, Wallet, Info, ArrowDownUp, Sparkles
} from 'lucide-react';
import clsx from 'clsx';
import { useVaultDeposit, useVaultWithdraw, useVaultStats } from '../hooks/useVault';
import { useUSDCBalance } from '../hooks/useProgram';
import { formatCompact, formatPrice } from '../utils/format';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Skeleton } from '../components/ui';

export function VaultPage() {
    const { isConnected } = useAccount();
    const { deposit, loading: isDepositing } = useVaultDeposit();
    const { withdraw, loading: isWithdrawing } = useVaultWithdraw();
    const { stats, loading: statsLoading } = useVaultStats();
    const { balance: usdcBalance, loading: balanceLoading } = useUSDCBalance();

    const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
    const [amount, setAmount] = useState('');

    const tvl = stats.tvl ?? 0;
    const userBalance = stats.userBalance ?? 0;
    const sharePrice = stats.sharePrice ?? 1;
    const accumulatedFees = stats.accumulatedFees ?? 0;
    const utilizationRate = stats.utilizationRate ?? 0;
    const availableLiquidity = stats.availableLiquidity ?? 0;
    const userShares = stats.userShares ?? 0;

    const handleAction = async () => {
        if (!isConnected) return;
        const num = parseFloat(amount);
        if (!amount || isNaN(num) || num <= 0) return;

        let success = false;
        if (activeTab === 'deposit') {
            success = await deposit(num);
        } else {
            success = await withdraw(num);
        }
        if (success) setAmount('');
    };

    const handleMax = () => {
        if (activeTab === 'deposit') {
            setAmount(usdcBalance.toFixed(2));
        } else {
            setAmount(userBalance.toFixed(2));
        }
    };

    const isActionDisabled = isDepositing || isWithdrawing || !amount || parseFloat(amount) <= 0;

    return (
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-text-primary mb-2 flex items-center gap-3">
                        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-indigo-500 flex items-center justify-center shadow-lg shadow-[var(--primary)]/20">
                            <TrendingUp className="w-5 h-5 lg:w-6 lg:h-6 text-white" />
                        </div>
                        Liquidity Vault
                    </h1>
                    <p className="text-text-secondary max-w-2xl text-sm sm:text-base lg:text-lg">
                        Provide liquidity to the protocol and earn fees from trader losses and borrowing interest.
                    </p>
                </div>
                <div className="glass-panel px-4 py-2.5 flex items-center gap-3">
                    <div className={clsx("w-2.5 h-2.5 rounded-full", stats.isPaused ? "bg-red-400" : "bg-emerald-400 animate-pulse")} />
                    <div>
                        <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Vault Status</div>
                        <div className={clsx("text-sm font-semibold", stats.isPaused ? "text-red-400" : "text-emerald-400")}>
                            {stats.isPaused ? 'Paused' : 'Active'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <StatCard icon={Lock} label="Total Value Locked" value={formatCompact(tvl)} sublabel="USDC in Vault" loading={statsLoading} />
                <StatCard icon={PieChart} label="Utilization" value={`${utilizationRate.toFixed(1)}%`} sublabel="Capital Efficiency" valueColor={utilizationRate > 80 ? 'text-orange-400' : 'text-blue-400'} loading={statsLoading} />
                <StatCard icon={TrendingUp} label="Share Price" value={`$${formatPrice(sharePrice, 4)}`} sublabel="USDC per LP" loading={statsLoading} />
                <StatCard icon={DollarSign} label="Fees Earned" value={formatCompact(accumulatedFees)} sublabel="Protocol Revenue" valueColor="text-emerald-400" loading={statsLoading} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 items-start">
                {/* ─── Main Action Card ─── */}
                <div className="lg:col-span-2 glass-panel overflow-hidden">
                    {/* Card Header with gradient accent */}
                    <div className="relative px-4 sm:px-6 lg:px-8 pt-5 sm:pt-6 lg:pt-8 pb-0">
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--primary)] via-indigo-500 to-purple-500" />
                        <div className="flex items-start sm:items-center justify-between gap-3 mb-5 sm:mb-6">
                            <div>
                                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-text-primary">Manage Liquidity</h2>
                                <p className="text-xs sm:text-sm text-text-secondary mt-1 max-w-md">Deposit USDC to mint LP tokens, or burn LP tokens to withdraw.</p>
                            </div>
                            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
                                <ArrowDownUp className="w-3.5 h-3.5 text-text-muted" />
                                <span className="text-xs font-mono text-text-secondary">1 LP = {formatPrice(sharePrice, 4)}</span>
                            </div>
                        </div>

                        {/* Animated Tabs */}
                        <div className="flex p-1 bg-[var(--bg-tertiary)] rounded-xl w-full max-w-xs">
                            {(['deposit', 'withdraw'] as const).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={clsx(
                                        'flex-1 relative py-2.5 text-sm font-bold rounded-lg transition-colors z-10',
                                        activeTab === tab ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
                                    )}
                                >
                                    {activeTab === tab && (
                                        <motion.div
                                            layoutId="vault-tab-indicator"
                                            className="absolute inset-0 bg-[var(--bg-primary)] rounded-lg shadow-sm"
                                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                        />
                                    )}
                                    <span className="relative z-10 capitalize">{tab}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Card Body */}
                    <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 lg:py-8">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-5 max-w-xl"
                            >
                                {/* Input Area */}
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs sm:text-sm font-medium">
                                        <span className="text-text-secondary">Amount ({activeTab === 'deposit' ? 'USDC' : 'LP Value'})</span>
                                        <span className="text-text-secondary">
                                            Bal:{' '}
                                            <span className="text-text-primary font-mono cursor-pointer hover:text-[var(--primary)] transition-colors" onClick={handleMax}>
                                                {activeTab === 'deposit'
                                                    ? (balanceLoading ? '...' : formatCompact(usdcBalance))
                                                    : (statsLoading ? '...' : formatCompact(userBalance))
                                                }
                                            </span>
                                        </span>
                                    </div>

                                    <div className="relative group">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={amount}
                                            onChange={(e) => {
                                                const next = e.target.value;
                                                if (/^\d*\.?\d*$/.test(next)) setAmount(next);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === '-' || e.key === '+') e.preventDefault();
                                            }}
                                            onPaste={(e) => {
                                                const pasted = e.clipboardData.getData('text');
                                                if (pasted.includes('-')) e.preventDefault();
                                            }}
                                            placeholder="0.00"
                                            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-text-primary text-xl sm:text-2xl lg:text-3xl font-mono font-medium py-4 sm:py-5 pl-4 sm:pl-5 pr-28 sm:pr-36 rounded-xl focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-all placeholder:text-text-muted/20"
                                        />
                                        <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-3">
                                            <button
                                                onClick={handleMax}
                                                className="text-[10px] sm:text-xs font-bold text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 px-2 py-1 rounded-md transition-colors"
                                            >
                                                MAX
                                            </button>
                                            <div className="h-6 sm:h-8 w-px bg-[var(--border-color)]" />
                                            <span className="text-sm sm:text-base font-bold text-text-muted">
                                                {activeTab === 'deposit' ? 'USDC' : 'USD'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Info Box */}
                                <div className="rounded-xl bg-[var(--bg-tertiary)]/40 border border-[var(--border-color)]/50 divide-y divide-[var(--border-color)]/50">
                                    <div className="flex justify-between items-center px-4 py-3">
                                        <span className="text-xs sm:text-sm text-text-muted">Exchange Rate</span>
                                        <span className="font-mono text-xs sm:text-sm text-text-primary">1 LP = {formatPrice(sharePrice, 4)} USDC</span>
                                    </div>
                                    <div className="flex justify-between items-center px-4 py-3">
                                        <span className="text-xs sm:text-sm text-text-muted">Min Lockup</span>
                                        <span className="text-xs sm:text-sm font-medium text-emerald-400">None</span>
                                    </div>
                                    {activeTab === 'withdraw' && utilizationRate > 80 && (
                                        <div className="px-4 py-3 text-orange-400 flex gap-2 items-start">
                                            <Info className="w-4 h-4 mt-0.5 shrink-0" />
                                            <span className="text-xs sm:text-sm">High utilization ({utilizationRate.toFixed(1)}%). Withdrawals may be queued.</span>
                                        </div>
                                    )}
                                </div>

                                {/* Action Button */}
                                {isConnected ? (
                                    <motion.button
                                        whileHover={!isActionDisabled ? { scale: 1.01 } : undefined}
                                        whileTap={!isActionDisabled ? { scale: 0.98 } : undefined}
                                        onClick={handleAction}
                                        disabled={isActionDisabled}
                                        className={clsx(
                                            "w-full py-3.5 sm:py-4 rounded-xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all",
                                            isActionDisabled
                                                ? "bg-[var(--bg-tertiary)] text-text-muted cursor-not-allowed border border-[var(--border-color)]"
                                                : "bg-gradient-to-r from-[var(--primary)] to-indigo-500 hover:from-[var(--primary)] hover:to-indigo-400 text-white shadow-lg shadow-[var(--primary)]/20"
                                        )}
                                    >
                                        {isDepositing || isWithdrawing ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <>
                                                {activeTab === 'deposit' ? 'Approve & Deposit' : 'Withdraw Liquidity'}
                                            </>
                                        )}
                                    </motion.button>
                                ) : (
                                    <ConnectButton.Custom>
                                        {({ openConnectModal }) => (
                                            <motion.button
                                                whileHover={{ scale: 1.01 }}
                                                whileTap={{ scale: 0.98 }}
                                                onClick={openConnectModal}
                                                className="w-full py-3.5 sm:py-4 rounded-xl font-bold text-sm sm:text-base bg-gradient-to-r from-[var(--primary)] to-indigo-500 text-white shadow-lg shadow-[var(--primary)]/20 flex items-center justify-center gap-2"
                                            >
                                                <Wallet className="w-4 h-4" />
                                                Connect Wallet
                                            </motion.button>
                                        )}
                                    </ConnectButton.Custom>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>

                {/* ─── Side Panels ─── */}
                <div className="space-y-4 sm:space-y-6">
                    {/* Your Position */}
                    <div className="glass-panel overflow-hidden">
                        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center">
                                <Wallet className="w-4 h-4 text-[var(--primary)]" />
                            </div>
                            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wide">Your Position</h3>
                        </div>
                        <div className="p-5">
                            {isConnected ? (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs text-text-muted font-medium mb-1">Vault Balance</div>
                                        <div className="text-xl sm:text-2xl font-mono font-bold text-text-primary">
                                            {statsLoading ? <Skeleton className="h-7 w-28" /> : formatCompact(userBalance)}
                                        </div>
                                        <div className="text-[11px] text-text-muted mt-1 font-mono">
                                            {statsLoading ? '...' : `${formatCompact(userShares)} LP Tokens`}
                                        </div>
                                    </div>
                                    <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent" />
                                    <div>
                                        <div className="text-xs text-text-muted font-medium mb-1">Wallet Balance</div>
                                        <div className="text-lg sm:text-xl font-mono font-medium text-text-primary">
                                            {balanceLoading ? <Skeleton className="h-6 w-24" /> : formatCompact(usdcBalance)}
                                        </div>
                                        <div className="text-[11px] text-text-muted mt-1">Available USDC</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="py-6 text-center">
                                    <Wallet className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
                                    <p className="text-text-muted text-sm">Connect to view position</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Vault Details */}
                    <div className="glass-panel overflow-hidden">
                        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                                <Sparkles className="w-4 h-4 text-indigo-400" />
                            </div>
                            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wide">Vault Details</h3>
                        </div>
                        <div className="divide-y divide-[var(--border-color)]/50">
                            {[
                                { label: 'Asset', value: stats.asset || 'USDC', mono: false },
                                { label: 'Type', value: 'Diversified Pool', mono: false },
                                { label: 'Liquidity', value: statsLoading ? '...' : formatCompact(availableLiquidity), mono: true },
                                { label: 'Lock-up', value: 'None', mono: false, accent: 'text-emerald-400' },
                            ].map(({ label, value, mono, accent }) => (
                                <div key={label} className="flex justify-between items-center px-5 py-3">
                                    <span className="text-xs text-text-muted">{label}</span>
                                    <span className={clsx("text-xs font-medium", mono && "font-mono", accent || "text-text-primary")}>{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, sublabel, valueColor, loading }: any) {
    return (
        <div className="glass-panel p-4 sm:p-5 flex flex-col justify-between h-full group hover:border-[var(--border-color-hover)] transition-all">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
                <span className="text-text-muted text-[10px] sm:text-xs uppercase tracking-wider font-bold leading-tight">{label}</span>
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center group-hover:bg-[var(--primary)]/10 transition-colors">
                    <Icon className="w-4 h-4 text-text-muted/60 group-hover:text-[var(--primary)] transition-colors" />
                </div>
            </div>
            <div>
                {loading ? (
                    <Skeleton className="h-7 w-24 mb-1" />
                ) : (
                    <div className={clsx('text-lg sm:text-2xl font-bold font-mono tracking-tight', valueColor || 'text-text-primary')}>
                        {value}
                    </div>
                )}
                <div className="text-[10px] sm:text-xs text-text-secondary font-medium mt-1">{sublabel}</div>
            </div>
        </div>
    );
}
