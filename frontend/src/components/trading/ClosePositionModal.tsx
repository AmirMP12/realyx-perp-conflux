import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { X, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { Position } from '../../hooks/usePositions';
import { useClosePosition, usePartialClose } from '../../hooks/useProgram';
import { usePythOnChainUpdater } from '../../hooks/usePythOnChainUpdater';

interface ClosePositionModalProps {
    isOpen: boolean;
    onClose: () => void;
    position: Position | null;
}

export function ClosePositionModal({ isOpen, onClose, position }: ClosePositionModalProps) {
    const [percentage, setPercentage] = useState(100);
    const { closePosition, loading: closing } = useClosePosition();
    const { partialClose, loading: partialClosing } = usePartialClose();
    const { pushLatestForMarkets, isPending: pythPushPending } = usePythOnChainUpdater();

    if (!position) return null;

    const loading = closing || partialClosing || pythPushPending;
    const isFullClose = percentage === 100;

    const size = parseFloat(position.size);
    const pnl = parseFloat(position.pnl);

    const closeSize = size * (percentage / 100);
    const estimatedPnL = pnl * (percentage / 100);

    const addr = position.marketAddress || '';
    const addrShort =
        addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || '—';

    const handleClose = async () => {
        let success = false;
        const posId = position.id;
        const m = position.marketAddress;
        if (m && m.startsWith('0x') && m.length === 42) {
            const pushed = await pushLatestForMarkets([m]);
            if (!pushed) return;
        }

        if (isFullClose) {
            success = await closePosition(posId);
        } else {
            success = await partialClose(posId, percentage, position.sizeRaw);
        }

        if (success) {
            onClose();
            setPercentage(100);
        }
    };

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-50">
            <DialogBackdrop transition className="fixed inset-0 bg-black/75 backdrop-blur-sm transition duration-200 ease-out data-closed:opacity-0" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel
                    transition
                    className="w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.45)] overflow-hidden transition duration-200 ease-out data-closed:scale-[0.98] data-closed:opacity-0"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[var(--border-color)]/80">
                        <div className="min-w-0">
                            <Dialog.Title className="text-lg font-bold text-text-primary tracking-tight">
                                Close position
                            </Dialog.Title>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span
                                    className={clsx(
                                        'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md',
                                        position.isLong ? 'text-[var(--long)] bg-[var(--long)]/12' : 'text-[var(--short)] bg-[var(--short)]/12'
                                    )}
                                >
                                    {position.isLong ? 'Long' : 'Short'}
                                </span>
                                <span className="text-xs font-mono text-text-muted truncate max-w-[200px]" title={addr}>
                                    {addrShort}
                                </span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="shrink-0 p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-[var(--bg-tertiary)] transition-colors"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="px-5 py-5 space-y-5">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Close amount</p>
                            <div className="rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-tertiary)]/80 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                                <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted mb-1">Notional</p>
                                <p className="text-3xl sm:text-4xl font-bold text-text-primary tabular-nums tracking-tight">
                                    <span className="text-text-secondary text-2xl sm:text-3xl font-semibold align-top mr-0.5">$</span>
                                    {closeSize.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <div
                                    className={clsx(
                                        'mt-3 flex items-center justify-between gap-3 pt-3 border-t border-[var(--border-color)]/60 text-sm font-semibold tabular-nums',
                                        estimatedPnL >= 0 ? 'text-[var(--long)]' : 'text-[var(--short)]'
                                    )}
                                >
                                    <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Est. PnL</span>
                                    <span>
                                        {estimatedPnL >= 0 ? '+' : ''}$
                                        {estimatedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">Size</p>
                            <div className="grid grid-cols-4 gap-2">
                                {[25, 50, 75, 100].map((pct) => (
                                    <button
                                        key={pct}
                                        type="button"
                                        onClick={() => setPercentage(pct)}
                                        className={clsx(
                                            'min-h-[44px] rounded-xl text-sm font-bold transition-all border',
                                            percentage === pct
                                                ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow-md shadow-[var(--primary)]/25'
                                                : 'bg-[var(--bg-tertiary)]/60 border-[var(--border-color)] text-text-secondary hover:border-[var(--border-color-hover)] hover:text-text-primary'
                                        )}
                                    >
                                        {pct}%
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 flex gap-3">
                            <div className="shrink-0 w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                                <AlertTriangle className="text-amber-400 w-4 h-4" aria-hidden />
                            </div>
                            <p className="text-xs text-text-secondary leading-relaxed pt-0.5">
                                Closing realizes PnL and returns collateral to your wallet.
                                {isFullClose
                                    ? ' A keeper fee applies on full close.'
                                    : ' Partial closes cannot leave a remainder below the protocol minimum position size—use a larger % or full close if the tx fails.'}
                            </p>
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className="sm:flex-1 py-3 rounded-xl text-sm font-semibold text-text-secondary border border-[var(--border-color)] hover:bg-[var(--bg-tertiary)] hover:text-text-primary transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleClose}
                                disabled={loading}
                                className={clsx(
                                    'sm:flex-[1.35] py-3 rounded-xl text-sm font-bold text-white shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]',
                                    isFullClose
                                        ? 'bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 shadow-rose-600/25'
                                        : 'bg-[var(--primary)] hover:opacity-95 shadow-[var(--primary)]/25'
                                )}
                            >
                                {loading ? 'Closing…' : isFullClose ? 'Close position' : `Close ${percentage}%`}
                            </button>
                        </div>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
