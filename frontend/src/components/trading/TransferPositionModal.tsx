import { useState, useEffect } from 'react';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { X, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import clsx from 'clsx';
import { useAccount } from 'wagmi';
import { isAddress, getAddress } from 'viem';
import { Position } from '../../hooks/usePositions';
import { useTransferPosition } from '../../hooks/useTransferPosition';

interface TransferPositionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    position: Position | null;
}

export function TransferPositionModal({ isOpen, onClose, onSuccess, position }: TransferPositionModalProps) {
    const { address: connected } = useAccount();
    const [recipient, setRecipient] = useState('');
    const [contractWarning, setContractWarning] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const { transfer, loading, isConfigured, recipientHasCode } = useTransferPosition();

    useEffect(() => {
        if (!isOpen) {
            setRecipient('');
            setContractWarning(null);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !recipient.trim()) {
            setContractWarning(null);
            return;
        }
        const t = recipient.trim();
        if (!isAddress(t)) {
            setContractWarning(null);
            return;
        }
        let cancelled = false;
        (async () => {
            setChecking(true);
            try {
                const addr = getAddress(t);
                const hasCode = await recipientHasCode(addr);
                if (!cancelled) {
                    setContractWarning(hasCode ? 'This address has contract code. The protocol will reject the transfer.' : null);
                }
            } catch {
                if (!cancelled) setContractWarning(null);
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [recipient, isOpen, recipientHasCode]);

    if (!position) return null;

    const trimmed = recipient.trim();
    const addressOk = trimmed.length > 0 && isAddress(trimmed);
    let recipientIsSelf = false;
    try {
        if (addressOk && connected) {
            recipientIsSelf = getAddress(trimmed).toLowerCase() === connected.toLowerCase();
        }
    } catch {
        recipientIsSelf = false;
    }

    const handleTransfer = async () => {
        const ok = await transfer(recipient, position.id);
        if (ok) {
            onSuccess?.();
            onClose();
        }
    };

    const addr = position.marketAddress || '';
    const addrShort = addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || '—';

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
                            <Dialog.Title className="text-lg font-bold text-text-primary tracking-tight flex items-center gap-2">
                                <ArrowRightLeft className="w-5 h-5 text-[var(--primary)] shrink-0" />
                                Transfer position
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
                                <span className="text-xs font-mono text-text-secondary">ID #{position.id}</span>
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

                    <div className="px-5 py-5 space-y-4">
                        {!isConfigured && (
                            <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                <span>Set <span className="font-mono text-xs">VITE_POSITION_TOKEN_ADDRESS</span> in the frontend env to enable transfers.</span>
                            </div>
                        )}

                        <div className="rounded-xl border border-[var(--border-color)]/80 bg-[var(--bg-tertiary)]/40 px-3 py-2.5 text-xs text-text-secondary leading-relaxed space-y-1.5">
                            <p>
                                The position is an NFT. The recipient becomes the on-chain owner and can manage or close it. They must be an{' '}
                                <strong className="text-text-primary">externally owned account</strong> (not a contract wallet), and their total
                                exposure must stay under the protocol cap.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="transfer-recipient" className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                                Recipient wallet
                            </label>
                            <input
                                id="transfer-recipient"
                                type="text"
                                value={recipient}
                                onChange={(e) => setRecipient(e.target.value)}
                                placeholder="0x…"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
                            />
                            {trimmed && !isAddress(trimmed) && (
                                <p className="text-xs text-rose-400">Enter a valid 0x address.</p>
                            )}
                            {addressOk && recipientIsSelf && (
                                <p className="text-xs text-rose-400">Use a different wallet than your connected address.</p>
                            )}
                            {checking && addressOk && !contractWarning && (
                                <p className="text-xs text-text-muted">Checking recipient…</p>
                            )}
                            {contractWarning && <p className="text-xs text-rose-400">{contractWarning}</p>}
                        </div>

                        <div className="flex gap-3 pt-1">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-2.5 rounded-xl border border-[var(--border-color)] text-text-primary text-sm font-semibold hover:bg-[var(--bg-tertiary)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={
                                    !isConfigured ||
                                    loading ||
                                    !addressOk ||
                                    recipientIsSelf ||
                                    !!contractWarning ||
                                    checking
                                }
                                onClick={() => void handleTransfer()}
                                className={clsx(
                                    'flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2',
                                    !isConfigured ||
                                        loading ||
                                        !addressOk ||
                                        recipientIsSelf ||
                                        !!contractWarning ||
                                        checking
                                        ? 'bg-[var(--bg-tertiary)] text-text-muted cursor-not-allowed'
                                        : 'bg-[var(--primary)] text-white hover:opacity-95'
                                )}
                            >
                                {loading ? 'Confirm in wallet…' : 'Transfer NFT'}
                            </button>
                        </div>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
