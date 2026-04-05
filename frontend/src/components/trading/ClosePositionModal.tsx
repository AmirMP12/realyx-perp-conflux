import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { X, AlertTriangle } from 'lucide-react';
import { Position } from '../../hooks/usePositions';
import { useClosePosition, usePartialClose } from '../../hooks/useProgram';

interface ClosePositionModalProps {
    isOpen: boolean;
    onClose: () => void;
    position: Position | null;
}

export function ClosePositionModal({ isOpen, onClose, position }: ClosePositionModalProps) {
    const [percentage, setPercentage] = useState(100);
    const { closePosition, loading: closing } = useClosePosition();
    const { partialClose, loading: partialClosing } = usePartialClose();

    if (!position) return null;

    const loading = closing || partialClosing;
    const isFullClose = percentage === 100;

    const size = parseFloat(position.size);
    const pnl = parseFloat(position.pnl);

    const closeSize = size * (percentage / 100);
    const estimatedPnL = pnl * (percentage / 100);

    const handleClose = async () => {
        let success = false;
        const posId = Number(position.id);

        if (isFullClose) {
            success = await closePosition(posId);
        } else {
            success = await partialClose(posId, percentage);
        }

        if (success) {
            onClose();
            setPercentage(100);
        }
    };

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-50">
            <DialogBackdrop transition className="fixed inset-0 bg-black/80 backdrop-blur-sm transition duration-200 ease-out data-closed:opacity-0" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel transition className="w-full max-w-sm bg-[#16161a] border border-[#2a2a35] rounded-lg shadow-2xl overflow-hidden transition duration-200 ease-out data-closed:scale-95 data-closed:opacity-0">
                    <div className="flex items-center justify-between p-4 border-b border-[#2a2a35]">
                        <Dialog.Title className="text-lg font-bold text-white">
                            Close Position
                        </Dialog.Title>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-4 space-y-5">
                        <div className="space-y-1">
                            <div className="flex justify-between text-sm text-gray-400">
                                <span>Close Amount</span>
                                <span className={position.isLong ? "text-[#30e0a1]" : "text-[#fa3c58]"}>
                                    {position.isLong ? "Long" : "Short"} {position.marketAddress.slice(0, 6)}...
                                </span>
                            </div>
                            <div className="text-3xl font-mono text-white">
                                <span className="text-lg text-gray-500">$</span>{closeSize.toFixed(2)} <span className="text-lg text-gray-500">Notional</span>
                            </div>
                            <div className={`text-sm font-mono ${estimatedPnL >= 0 ? 'text-[#30e0a1]' : 'text-[#fa3c58]'}`}>
                                {estimatedPnL >= 0 ? '+' : ''}${estimatedPnL.toFixed(2)} PnL (Est.)
                            </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                            {[25, 50, 75, 100].map((pct) => (
                                <button
                                    key={pct}
                                    onClick={() => setPercentage(pct)}
                                    className={`py-2 text-sm font-bold rounded-md border transition-all ${percentage === pct
                                        ? 'bg-[#2d42fc] border-[#2d42fc] text-white'
                                        : 'bg-[#10111a] border-[#2a2a35] text-gray-400 hover:border-gray-500 hover:text-white'
                                        }`}
                                >
                                    {pct}%
                                </button>
                            ))}
                        </div>

                        <div className="p-3 bg-[#10111a] border border-[#2a2a35] rounded-md flex items-start gap-3">
                            <AlertTriangle className="text-yellow-500 mt-0.5 shrink-0" size={16} />
                            <p className="text-xs text-gray-400 leading-relaxed">
                                Closing will realize PnL and return remaining collateral to your wallet.
                                {isFullClose ? " A keeper fee will be deducted." : " Partial close reduces size and collateral proportionally."}
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 py-3 text-sm font-bold text-gray-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleClose}
                                disabled={loading}
                                className={`flex-[2] py-3 text-sm font-bold rounded-lg text-white shadow-lg transition-all ${isFullClose
                                    ? 'bg-[#fa3c58] hover:bg-[#d62e49] shadow-[#fa3c58]/20'
                                    : 'bg-[#2d42fc] hover:bg-[#2536d0] shadow-[#2d42fc]/20'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {loading ? 'Closing...' : isFullClose ? 'Close Position' : `Close ${percentage}%`}
                            </button>
                        </div>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
