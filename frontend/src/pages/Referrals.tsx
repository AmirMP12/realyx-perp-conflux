import { useState, type ComponentType } from 'react';
import { useAccount } from 'wagmi';
import { motion } from 'framer-motion';
import { Copy, Check, Users, DollarSign, Gift, Share2 } from 'lucide-react';
import { useReferralStats } from '../hooks/useBackend';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { formatCompact } from '../utils/format';
import { Skeleton } from '../components/ui';

export function ReferralsPage() {
    const { isConnected } = useAccount();
    const { stats, link, loading, error } = useReferralStats();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            toast.success('Referral link copied!');
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error('Could not copy to clipboard');
        }
    };

    const copyDisabled = !link;

    return (
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 lg:space-y-12">
            {/* Hero Section */}
            <div className="text-center space-y-4 max-w-3xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-sm font-bold mb-2"
                >
                    <Gift className="w-4 h-4" />
                    <span>Refer & Earn Program</span>
                </motion.div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-text-primary tracking-tight">
                    Invite Friends, <span className="text-[var(--primary)]">Earn 10%</span> Fees
                </h1>
                <p className="text-sm sm:text-base lg:text-xl text-text-secondary max-w-2xl mx-auto">
                    Share your unique link. You earn 10% of trading fees from anyone who signs up, and they get a 5% fee discount.
                </p>
            </div>

            {/* Link Generation Card */}
            <div className="max-w-2xl mx-auto">
                <div className="glass-panel p-4 sm:p-6 lg:p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-32 bg-[var(--primary)]/5 blur-3xl rounded-full pointer-events-none" />

                    {!isConnected ? (
                        <div className="text-center space-y-5 py-10 px-4 rounded-xl border border-dashed border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/35 mx-auto max-w-lg">
                            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-center mx-auto">
                                <Share2 className="w-8 h-8 text-text-muted" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-text-primary mb-1">Connect to get your link</h3>
                                <p className="text-text-muted text-sm max-w-sm mx-auto">We&apos;ll generate a unique referral URL tied to your wallet.</p>
                            </div>
                            <div className="flex justify-center pt-1">
                                <ConnectButton />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-secondary">Your Unique Referral Link</label>
                                <div className="flex gap-2">
                                    <div className="flex-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl px-4 py-3 font-mono text-sm text-text-primary truncate flex items-center min-h-[48px]">
                                        {loading ? (
                                            <Skeleton className="h-4 w-full max-w-md" />
                                        ) : (
                                            (link ?? '—')
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        disabled={copyDisabled}
                                        className="bg-[var(--primary)] hover:bg-[var(--primary)] text-white px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                                    >
                                        {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                                        {copied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4">
                                <div className="p-4 bg-[var(--bg-tertiary)]/50 rounded-lg border border-[var(--border-color)] text-center">
                                    <div className="text-text-secondary text-xs uppercase tracking-wider font-bold mb-1">Your Code</div>
                                    <div className="text-lg sm:text-2xl font-mono font-bold text-[var(--primary)]">
                                        {loading ? <Skeleton className="h-8 w-24 mx-auto" /> : stats.code || '—'}
                                    </div>
                                </div>
                                <div className="p-4 bg-[var(--bg-tertiary)]/50 rounded-lg border border-[var(--border-color)] text-center">
                                    <div className="text-text-secondary text-xs uppercase tracking-wider font-bold mb-1">Status</div>
                                    <div className="text-lg sm:text-2xl font-bold text-emerald-400">Active</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {error ? (
                <p className="text-center text-sm text-orange-400 max-w-2xl mx-auto" role="alert">
                    {error}
                </p>
            ) : null}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    icon={Users}
                    label="Total Referees"
                    value={String(stats.referees)}
                    sublabel="Active Traders"
                    loading={loading}
                />
                <StatCard
                    icon={DollarSign}
                    label="Total Earned"
                    value={formatCompact(stats.totalEarned)}
                    sublabel="USDC Commissions"
                    valueColor="text-emerald-400"
                    loading={loading}
                />
                <StatCard
                    icon={Gift}
                    label="Pending Claim"
                    value={formatCompact(stats.pendingClaim)}
                    sublabel="Available to Withdraw"
                    loading={loading}
                />
            </div>

            {/* FAQ Area */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8 border-t border-[var(--border-color)]">
                <div className="space-y-2">
                    <h3 className="font-bold text-text-primary">How do I earn rewards?</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">
                        Share your referral link with friends. When they connect their wallet using your link, their address is bonded to yours. You receive 10% of all trading fees they generate, paid in USDC.
                    </p>
                </div>
                <div className="space-y-2">
                    <h3 className="font-bold text-text-primary">When are rewards paid?</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">
                        Rewards accrue in real-time as trades are closed. You can claim your pending rewards at any time directly to your wallet. There is no minimum claim amount.
                    </p>
                </div>
            </div>
        </div>
    );
}

type StatCardProps = {
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    sublabel: string;
    valueColor?: string;
    loading?: boolean;
};

function StatCard({ icon: Icon, label, value, sublabel, valueColor, loading }: StatCardProps) {
    return (
        <div className="glass-panel p-4 sm:p-6 flex items-center justify-between hover:bg-[var(--bg-tertiary)]/20 transition-colors">
            <div>
                <div className="text-sm text-text-secondary font-medium mb-1">{label}</div>
                {loading ? (
                    <Skeleton className="h-8 w-28 mb-1" />
                ) : (
                    <div className={clsx('text-2xl font-bold font-mono', valueColor || 'text-text-primary')}>{value}</div>
                )}
                <div className="text-xs text-text-muted mt-1">{sublabel}</div>
            </div>
            <div className="w-12 h-12 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
                <Icon className="w-6 h-6 text-[var(--primary)]" />
            </div>
        </div>
    );
}
