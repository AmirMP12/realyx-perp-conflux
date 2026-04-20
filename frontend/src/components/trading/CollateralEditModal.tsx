import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { Position } from '../../hooks/usePositions';
import { useModifyMargin } from '../../hooks/useProgram';
import toast from 'react-hot-toast';

interface CollateralEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    position: Position | null;
}

function filterDecimalInput(raw: string): string {
    const t = raw.replace(/[^\d.]/g, '');
    if (!t) return '';
    const parts = t.split('.');
    if (parts.length === 1) return parts[0];
    return `${parts[0]}.${parts.slice(1).join('')}`;
}

export function CollateralEditModal({ isOpen, onClose, position }: CollateralEditModalProps) {
    const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
    const [amount, setAmount] = useState('');
    const { modifyMargin, loading } = useModifyMargin();

    if (!position) return null;

    const handleSubmit = async () => {
        const val = parseFloat(amount.replace(/,/g, '').trim());
        if (!amount.trim() || !Number.isFinite(val) || val <= 0) {
            toast.error('Enter a valid amount');
            return;
        }
        const delta = mode === 'deposit' ? val : -val;

        await modifyMargin(Number(position.id), delta);
        setAmount('');
        onClose();
    };

    const currentCollateral = parseFloat(position.collateral);
    const leverage = Number(position.leverage);
    const size = Number(position.size);

    const amountNum = parseFloat(amount.replace(/,/g, '').trim()) || 0;
    const newCollateral = mode === 'deposit' ? currentCollateral + amountNum : currentCollateral - amountNum;
    const newLeverage = newCollateral > 0 ? size / newCollateral : 0;

    const withdrawInvalid = mode === 'withdraw' && amountNum > currentCollateral;

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-[100]">
            <DialogBackdrop
                transition
                className="fixed inset-0 bg-black/75 backdrop-blur-sm transition duration-200 ease-out data-closed:opacity-0"
                aria-hidden="true"
            />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel
                    transition
                    className="w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.45)] overflow-hidden transition duration-200 ease-out data-closed:scale-[0.98] data-closed:opacity-0"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[var(--border-color)]/80">
                        <Dialog.Title className="text-lg font-bold text-text-primary tracking-tight">
                            Edit collateral
                        </Dialog.Title>
                        <button
                            type="button"
                            onClick={onClose}
                            className="shrink-0 p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/50"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="px-5 py-5 space-y-5">
                        <div className="flex p-1 rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-tertiary)]/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <button
                                type="button"
                                onClick={() => setMode('deposit')}
                                className={clsx(
                                    'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40',
                                    mode === 'deposit'
                                        ? 'bg-[var(--primary)] text-white shadow-md shadow-[var(--primary)]/20'
                                        : 'text-text-secondary hover:text-text-primary'
                                )}
                            >
                                Deposit
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('withdraw')}
                                className={clsx(
                                    'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40',
                                    mode === 'withdraw'
                                        ? 'bg-[var(--primary)] text-white shadow-md shadow-[var(--primary)]/20'
                                        : 'text-text-secondary hover:text-text-primary'
                                )}
                            >
                                Withdraw
                            </button>
                        </div>

                        <div>
                            <div className="flex justify-between text-xs font-medium text-text-muted mb-2">
                                <span>Current collateral</span>
                                <span className="font-mono tabular-nums text-text-primary">${currentCollateral.toFixed(2)}</span>
                            </div>
                            <div className="relative rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-tertiary)]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus-within:border-[var(--primary)]/55 focus-within:ring-2 focus-within:ring-[var(--primary)]/15 transition-all">
                                <input
                                    id="collateral-amount"
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    value={amount}
                                    onChange={(e) => setAmount(filterDecimalInput(e.target.value))}
                                    placeholder="0.00"
                                    className="w-full min-w-0 bg-transparent border-0 rounded-xl py-3 pl-4 pr-16 font-mono text-sm text-text-primary placeholder:text-text-muted/50 outline-none ring-0"
                                />
                                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-text-muted">
                                    USDC
                                </span>
                            </div>
                            {withdrawInvalid && (
                                <p className="mt-1.5 text-xs text-rose-400">Amount exceeds available collateral.</p>
                            )}
                        </div>

                        <div className="rounded-xl border border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/40 p-4 space-y-3">
                            <div className="flex justify-between text-xs gap-3">
                                <span className="text-text-muted shrink-0">New collateral</span>
                                <div className="flex items-center gap-2 min-w-0 justify-end font-mono tabular-nums text-right">
                                    <span className="text-text-muted/70 line-through text-[11px]">${currentCollateral.toFixed(2)}</span>
                                    <span className="text-[var(--long)] font-semibold">${newCollateral.toFixed(2)}</span>
                                </div>
                            </div>
                            <div className="flex justify-between text-xs gap-3">
                                <span className="text-text-muted shrink-0">New leverage</span>
                                <div className="flex items-center gap-2 min-w-0 justify-end font-mono tabular-nums text-right">
                                    <span className="text-text-muted/70 line-through text-[11px]">{leverage.toFixed(1)}x</span>
                                    <span className="text-[var(--long)] font-semibold">{newLeverage.toFixed(1)}x</span>
                                </div>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={loading || !amount.trim() || !Number.isFinite(amountNum) || amountNum <= 0 || withdrawInvalid}
                            className="w-full py-3 rounded-xl font-bold text-sm text-white bg-[var(--primary)] hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-45 disabled:cursor-not-allowed shadow-lg shadow-[var(--primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/50"
                        >
                            {loading ? 'Confirming…' : mode === 'deposit' ? 'Deposit collateral' : 'Withdraw collateral'}
                        </button>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
