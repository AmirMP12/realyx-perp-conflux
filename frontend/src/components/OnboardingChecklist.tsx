import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, X, Rocket } from 'lucide-react';
import clsx from 'clsx';
import { useUSDCBalance } from '../hooks/useProgram';
import { realyxChains } from '../config/wagmi';

const STORAGE_KEY = 'realyx_onboarding_dismissed_v1';

type StepId = 'connect' | 'network' | 'fund' | 'trade';

/**
 * Guided first-trade flow.
 *
 * A compact, self-advancing checklist that walks a new user through the exact
 * path to their first trade: connect → switch to eSpace → fund (mint test
 * USDT0) → place a trade. Each step auto-completes from real wallet state
 * (account, chain id, balance) so the user always sees their true progress, and
 * the current step exposes a one-tap action (connect modal, network switch,
 * mint link, trade link). Dismissed state is persisted so it never nags a
 * returning user.
 */
export function OnboardingChecklist() {
    const navigate = useNavigate();
    const { isConnected } = useAccount();
    const chainId = useChainId();
    const { switchChain } = useSwitchChain();
    const { balance } = useUSDCBalance();

    const [dismissed, setDismissed] = useState(true); // default hidden until we read storage
    const [collapsed, setCollapsed] = useState(false);

    const defaultChainId = realyxChains[0].id;
    const onCorrectChain = chainId === defaultChainId;
    const hasFunds = (balance ?? 0) > 0;

    useEffect(() => {
        setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
    }, []);

    const steps: Array<{ id: StepId; label: string; done: boolean }> = [
        { id: 'connect', label: 'Connect your wallet', done: isConnected },
        { id: 'network', label: 'Switch to eSpace Testnet', done: isConnected && onCorrectChain },
        { id: 'fund', label: 'Mint test USDT0', done: isConnected && onCorrectChain && hasFunds },
        { id: 'trade', label: 'Place your first trade', done: false },
    ];

    const completedCount = steps.filter((s) => s.done).length;
    const allDone = completedCount >= 3; // first three are state-detectable
    const activeStep = steps.find((s) => !s.done) ?? steps[steps.length - 1];

    // Auto-dismiss once the user is fully set up and has funds — they don't need
    // the checklist once trading is unblocked.
    useEffect(() => {
        if (allDone && hasFunds) {
            // Leave a short grace so they see the final "place a trade" nudge.
        }
    }, [allDone, hasFunds]);

    const dismiss = () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        setDismissed(true);
    };

    if (dismissed) return null;

    return (
        <div className="fixed bottom-20 lg:bottom-6 right-3 sm:right-6 z-[80] w-[calc(100vw-1.5rem)] sm:w-80 max-w-sm">
            <AnimatePresence mode="wait">
                <motion.div
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 16, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    className="glass-panel-elevated rounded-2xl overflow-hidden shadow-[0_24px_50px_rgba(0,0,0,0.4)] border border-brand/30"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[linear-gradient(180deg,rgba(45,66,252,0.12),transparent)] border-b border-line/60">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-brand/15 text-[var(--primary)]">
                                <Rocket className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-text-primary leading-tight">Get started</p>
                                <p className="text-[11px] text-text-muted tabular-nums">{completedCount} of {steps.length} steps</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                type="button"
                                onClick={() => setCollapsed((v) => !v)}
                                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3/60 transition-colors"
                                aria-label={collapsed ? 'Expand checklist' : 'Collapse checklist'}
                            >
                                <ChevronRight className={clsx('w-4 h-4 transition-transform', collapsed ? '' : 'rotate-90')} />
                            </button>
                            <button
                                type="button"
                                onClick={dismiss}
                                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3/60 transition-colors"
                                aria-label="Dismiss onboarding"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1 bg-[var(--bg-secondary)]">
                        <div
                            className="h-full bg-[var(--primary)] transition-all duration-500"
                            style={{ width: `${(completedCount / steps.length) * 100}%` }}
                        />
                    </div>

                    {!collapsed && (
                        <div className="p-3 space-y-1">
                            {steps.map((step) => {
                                const isActive = step.id === activeStep.id && !step.done;
                                return (
                                    <div
                                        key={step.id}
                                        className={clsx(
                                            'flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors',
                                            isActive ? 'bg-brand/10 border border-brand/25' : 'border border-transparent',
                                        )}
                                    >
                                        <span
                                            className={clsx(
                                                'shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold',
                                                step.done
                                                    ? 'bg-[var(--long)] text-white'
                                                    : isActive
                                                        ? 'bg-brand/20 text-[var(--primary)] border border-brand/40'
                                                        : 'bg-surface-3/70 text-text-muted border border-line/60',
                                            )}
                                        >
                                            {step.done ? <Check className="w-3 h-3" strokeWidth={3} /> : steps.indexOf(step) + 1}
                                        </span>
                                        <span className={clsx('text-sm flex-1 min-w-0', step.done ? 'text-text-muted line-through' : 'text-text-primary')}>
                                            {step.label}
                                        </span>
                                        {isActive && (
                                            <StepAction
                                                step={step.id}
                                                onSwitch={() => switchChain?.({ chainId: defaultChainId })}
                                                onMint={() => navigate('/settings')}
                                                onTrade={() => {
                                                    dismiss();
                                                    navigate('/trade');
                                                }}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}

function StepAction({
    step,
    onSwitch,
    onMint,
    onTrade,
}: {
    step: StepId;
    onSwitch: () => void;
    onMint: () => void;
    onTrade: () => void;
}) {
    const btn =
        'shrink-0 px-2.5 py-1 rounded-lg bg-[var(--primary)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50';

    if (step === 'connect') {
        return (
            <ConnectButton.Custom>
                {({ openConnectModal }) => (
                    <button type="button" onClick={openConnectModal} className={btn}>
                        Connect
                    </button>
                )}
            </ConnectButton.Custom>
        );
    }
    if (step === 'network') {
        return (
            <button type="button" onClick={onSwitch} className={btn}>
                Switch
            </button>
        );
    }
    if (step === 'fund') {
        return (
            <button type="button" onClick={onMint} className={btn}>
                Mint
            </button>
        );
    }
    return (
        <button type="button" onClick={onTrade} className={btn}>
            Trade
        </button>
    );
}
