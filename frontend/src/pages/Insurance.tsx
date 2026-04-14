import { useState } from 'react';
import { useAccount } from 'wagmi';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, Activity, DollarSign, ExternalLink, Loader2, Wallet, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { useInsuranceFund, useStakeInsurance, useUnstakeInsurance } from '../hooks/useVault';
import { useBackendStats, useInsuranceClaims } from '../hooks/useBackend';
import { useUSDCBalance } from '../hooks/useProgram';
import { Skeleton } from '../components/ui';
import { formatCompact } from '../utils/format';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const EXPLORER_TX = (txHash: string) => `https://evmtestnet.confluxscan.net/tx/${txHash}`;

export function InsurancePage() {
    const { isConnected } = useAccount();
    const insurance = useInsuranceFund();
    const { stats: protocolStats, loading: statsLoading } = useBackendStats();
    const { claims, loading: claimsLoading } = useInsuranceClaims(20);
    const { stake, loading: stakeLoading } = useStakeInsurance();
    const { unstake, loading: unstakeLoading } = useUnstakeInsurance();
    const { balance: usdcBalance, loading: balanceLoading } = useUSDCBalance();

    const [activeTab, setActiveTab] = useState<'stake' | 'unstake'>('stake');
    const [amount, setAmount] = useState('');

    const totalLiquidations = protocolStats?.totalLiquidations ?? '0';
    const totalPayouts = claims
        .filter((c) => c.coveredAt)
        .reduce((sum, c) => sum + parseFloat(c.amountUsd), 0);

    const handleAction = async () => {
        if (!isConnected) return;
        const num = parseFloat(amount);
        if (isNaN(num) || num <= 0) return;

        let success = false;
        if (activeTab === 'stake') {
            success = await stake(num);
        } else {
            const sharePrice = insurance.insSharePrice;
            if (sharePrice <= 0) return;
            const sharesToRedeem = num / sharePrice;
            success = await unstake(sharesToRedeem);
        }

        if (success) {
            setAmount('');
        }
    };

    const handleMax = () => {
        if (activeTab === 'stake') {
            setAmount(usdcBalance.toFixed(2));
        } else {
            setAmount(insurance.userInsuranceBalance.toFixed(2));
        }
    };

    const formatDate = (iso: string) => {
        try {
            return new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            }).format(new Date(iso));
        } catch {
            return iso;
        }
    };

    const isActionDisabled = stakeLoading || unstakeLoading || !amount || parseFloat(amount) <= 0 || (activeTab === 'unstake' && insurance.circuitBreakerActive);

    return (
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-text-primary mb-2 flex items-center gap-3">
                        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <Shield className="w-5 h-5 lg:w-6 lg:h-6 text-white" />
                        </div>
                        Insurance Fund
                    </h1>
                    <p className="text-text-secondary max-w-2xl text-sm sm:text-base lg:text-lg">
                        Protects the protocol against insolvency. Stake USDC to earn a share of liquidations.
                    </p>
                </div>
                <div className="glass-panel px-4 py-2.5 flex items-center gap-3">
                    <div className={clsx("w-2.5 h-2.5 rounded-full", insurance.isHealthy ? "bg-emerald-400 animate-pulse" : "bg-red-400")} />
                    <div>
                        <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Status</div>
                        <div className={clsx("text-sm font-semibold", insurance.isHealthy ? "text-emerald-400" : "text-red-400")}>
                            {insurance.isHealthy ? 'Healthy' : 'At Risk'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <StatCard icon={DollarSign} label="Insurance Assets" value={formatCompact(insurance.insuranceAssets)} sublabel="Total Capital" loading={insurance.loading} />
                <StatCard icon={Activity} label="Health Ratio" value={`${insurance.healthRatioPercent.toFixed(2)}%`} sublabel="Solvency Metric" valueColor={insurance.isHealthy ? 'text-emerald-400' : 'text-red-400'} loading={insurance.loading} />
                <StatCard icon={AlertTriangle} label="Total Payouts" value={formatCompact(totalPayouts)} sublabel="Bad Debt Covered" valueColor="text-orange-400" loading={claimsLoading} />
                <StatCard icon={Activity} label="Liquidations" value={totalLiquidations} sublabel="Protocol Wide" loading={statsLoading} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 items-start">
                {/* ─── Main Action Card ─── */}
                <div className="lg:col-span-2 glass-panel overflow-hidden">
                    {/* Card Header with gradient accent */}
                    <div className="relative px-4 sm:px-6 lg:px-8 pt-5 sm:pt-6 lg:pt-8 pb-0">
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
                        <div className="flex items-start sm:items-center justify-between gap-3 mb-5 sm:mb-6">
                            <div>
                                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-text-primary">Manage Insurance</h2>
                                <p className="text-xs sm:text-sm text-text-secondary mt-1 max-w-md">Stake USDC to back the protocol and earn yield from liquidation fees.</p>
                            </div>
                            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]">
                                <Shield className="w-3.5 h-3.5 text-text-muted" />
                                <span className="text-xs font-mono text-text-secondary">1 INS = {insurance.insSharePrice.toFixed(4)}</span>
                            </div>
                        </div>

                        {/* Animated Tabs */}
                        <div className="flex p-1 bg-[var(--bg-tertiary)] rounded-xl w-full max-w-xs">
                            {(['stake', 'unstake'] as const).map((tab) => (
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
                                            layoutId="insurance-tab-indicator"
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
                                        <span className="text-text-secondary">Amount (USDC Value)</span>
                                        <span className="text-text-secondary">
                                            Bal:{' '}
                                            <span className="text-text-primary font-mono cursor-pointer hover:text-[var(--primary)] transition-colors" onClick={handleMax}>
                                                {activeTab === 'stake'
                                                    ? (balanceLoading ? '...' : formatCompact(usdcBalance))
                                                    : (insurance.loading ? '...' : formatCompact(insurance.userInsuranceBalance))
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
                                            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-text-primary text-xl sm:text-2xl lg:text-3xl font-mono font-medium py-4 sm:py-5 pl-4 sm:pl-5 pr-28 sm:pr-36 rounded-xl focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all placeholder:text-text-muted/20"
                                        />
                                        <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-3">
                                            <button
                                                onClick={handleMax}
                                                className="text-[10px] sm:text-xs font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 rounded-md transition-colors"
                                            >
                                                MAX
                                            </button>
                                            <div className="h-6 sm:h-8 w-px bg-[var(--border-color)]" />
                                            <span className="text-sm sm:text-base font-bold text-text-muted">USDC</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Info Box */}
                                <div className="rounded-xl bg-[var(--bg-tertiary)]/40 border border-[var(--border-color)]/50 divide-y divide-[var(--border-color)]/50">
                                    <div className="flex justify-between items-center px-4 py-3">
                                        <span className="text-xs sm:text-sm text-text-muted">Exchange Rate</span>
                                        <span className="font-mono text-xs sm:text-sm text-text-primary">1 INS = {insurance.insSharePrice.toFixed(4)} USDC</span>
                                    </div>
                                    <div className="flex justify-between items-center px-4 py-3">
                                        <span className="text-xs sm:text-sm text-text-muted">Circuit Breaker</span>
                                        <span className={clsx("text-xs sm:text-sm font-medium", insurance.circuitBreakerActive ? "text-red-400" : "text-emerald-400")}>
                                            {insurance.circuitBreakerActive ? "Active (Paused)" : "Inactive"}
                                        </span>
                                    </div>
                                    {insurance.circuitBreakerActive && activeTab === 'unstake' && (
                                        <div className="px-4 py-3 text-red-400 flex gap-2 items-start">
                                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                            <span className="text-xs sm:text-sm">Circuit breaker active — unstaking paused to protect solvency.</span>
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
                                                : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/20"
                                        )}
                                    >
                                        {stakeLoading || unstakeLoading ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <>
                                                {activeTab === 'stake' ? 'Stake Insurance' : 'Unstake Insurance'}
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
                                                className="w-full py-3.5 sm:py-4 rounded-xl font-bold text-sm sm:text-base bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
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
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                <Wallet className="w-4 h-4 text-emerald-400" />
                            </div>
                            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wide">Your Position</h3>
                        </div>
                        <div className="p-5">
                            {isConnected ? (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs text-text-muted font-medium mb-1">Staked Balance</div>
                                        <div className="text-xl sm:text-2xl font-mono font-bold text-text-primary">
                                            {insurance.loading ? <Skeleton className="h-7 w-28" /> : formatCompact(insurance.userInsuranceBalance)}
                                        </div>
                                        <div className="text-[11px] text-text-muted mt-1 font-mono">
                                            {insurance.loading ? '...' : `${formatCompact(insurance.userInsShares)} INS Tokens`}
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
                                <div className="py-8 px-4 text-center rounded-xl border border-dashed border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/40">
                                    <div className="w-14 h-14 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-center mx-auto mb-4">
                                        <Wallet className="w-7 h-7 text-text-muted" />
                                    </div>
                                    <p className="text-text-primary font-semibold text-sm mb-1">Connect your wallet</p>
                                    <p className="text-text-muted text-xs mb-5 max-w-[220px] mx-auto leading-relaxed">
                                        See staked insurance balance and manage stake or unstake.
                                    </p>
                                    <div className="flex justify-center">
                                        <ConnectButton />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Recent Claims */}
                    <div className="glass-panel overflow-hidden">
                        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                                <Sparkles className="w-4 h-4 text-orange-400" />
                            </div>
                            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wide">Recent Claims</h3>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                            {claimsLoading ? (
                                <div className="p-5 space-y-3">
                                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                                </div>
                            ) : claims.length === 0 ? (
                                <div className="py-10 px-4 text-center mx-3 my-3 rounded-xl border border-dashed border-[var(--border-color)]/70 bg-[var(--bg-tertiary)]/30">
                                    <Shield className="w-9 h-9 text-text-muted mx-auto mb-3 opacity-60" />
                                    <p className="text-text-primary text-sm font-medium mb-1">No recent claims</p>
                                    <p className="text-text-muted text-xs max-w-[240px] mx-auto">Insurance payouts will appear here when they occur.</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-[var(--border-color)]/50">
                                    {claims.map((claim) => (
                                        <motion.div
                                            key={claim.id}
                                            className="px-5 py-3.5 hover:bg-[var(--bg-tertiary)]/30 transition-colors"
                                            whileHover={{ x: 2 }}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-xs font-bold text-text-primary">
                                                    Position #{claim.positionId}
                                                </span>
                                                <span className="text-[10px] text-text-muted">{formatDate(claim.submittedAt)}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <a
                                                    href={EXPLORER_TX(claim.txHash)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] text-[var(--primary)] hover:underline flex items-center gap-1"
                                                >
                                                    TX <ExternalLink className="w-2.5 h-2.5" />
                                                </a>
                                                <span className="font-mono text-sm font-bold text-red-400">-{formatCompact(parseFloat(claim.amountUsd))}</span>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
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
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center group-hover:bg-emerald-500/10 transition-colors">
                    <Icon className="w-4 h-4 text-text-muted/60 group-hover:text-emerald-400 transition-colors" />
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
