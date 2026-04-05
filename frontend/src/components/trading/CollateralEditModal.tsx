import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { X } from 'lucide-react';
import { Position } from '../../hooks/usePositions';
import { useModifyMargin } from '../../hooks/useProgram';
import toast from 'react-hot-toast';

interface CollateralEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    position: Position | null;
}

export function CollateralEditModal({ isOpen, onClose, position }: CollateralEditModalProps) {
    const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
    const [amount, setAmount] = useState('');
    const { modifyMargin, loading } = useModifyMargin();

    if (!position) return null;

    const handleSubmit = async () => {
        if (!amount || parseFloat(amount) <= 0) {
            toast.error("Enter a valid amount");
            return;
        }
        const val = parseFloat(amount);
        const delta = mode === 'deposit' ? val : -val;

        await modifyMargin(Number(position.id), delta);
        setAmount('');
        onClose();
    };

    const currentCollateral = parseFloat(position.collateral);
    const leverage = Number(position.leverage);
    const size = Number(position.size);

    const newCollateral = mode === 'deposit'
        ? currentCollateral + (parseFloat(amount) || 0)
        : currentCollateral - (parseFloat(amount) || 0);

    const newLeverage = newCollateral > 0 ? size / newCollateral : 0;

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-50">
            <DialogBackdrop transition className="fixed inset-0 bg-black/80 backdrop-blur-sm transition duration-200 ease-out data-closed:opacity-0" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel transition className="w-full max-w-sm bg-[#16161a] border border-[#2a2a35] rounded-lg shadow-2xl overflow-hidden transition duration-200 ease-out data-closed:scale-95 data-closed:opacity-0">
                    <div className="flex items-center justify-between p-4 border-b border-[#2a2a35]">
                        <Dialog.Title className="text-lg font-bold text-white">
                            Edit Collateral
                        </Dialog.Title>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-4 space-y-4">
                        <div className="flex p-1 bg-[#10111a] rounded-lg border border-[#2a2a35]">
                            <button
                                onClick={() => setMode('deposit')}
                                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'deposit'
                                    ? 'bg-[#2d42fc] text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                Deposit
                            </button>
                            <button
                                onClick={() => setMode('withdraw')}
                                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'withdraw'
                                    ? 'bg-[#2d42fc] text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                Withdraw
                            </button>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-gray-400">
                                <span>Current Collateral</span>
                                <span className="text-white font-mono">${currentCollateral.toFixed(2)}</span>
                            </div>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full bg-[#10111a] border border-[#2a2a35] rounded-md py-2 px-3 text-white placeholder-gray-600 focus:border-[#2d42fc] focus:outline-none transition-colors font-mono"
                                />
                                <span className="absolute right-3 top-2 text-xs text-gray-500 font-bold">USDC</span>
                            </div>
                        </div>

                        <div className="bg-[#10111a] rounded-md p-3 space-y-2 border border-[#2a2a35]">
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-400">New Collateral</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 line-through">${currentCollateral.toFixed(2)}</span>
                                    <span className="text-[#30e0a1] font-mono">${newCollateral.toFixed(2)}</span>
                                </div>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-400">New Leverage</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 line-through">{leverage.toFixed(1)}x</span>
                                    <span className="text-[#30e0a1] font-mono">{newLeverage.toFixed(1)}x</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleSubmit}
                            disabled={loading || !amount || parseFloat(amount) <= 0 || (mode === 'withdraw' && parseFloat(amount) > currentCollateral)}
                            className="w-full py-2.5 bg-[#2d42fc] hover:bg-[#2536d0] disabled:bg-[#1f1f2e] disabled:text-gray-600 text-white font-bold rounded-lg transition-all"
                        >
                            {loading ? 'Confirming...' : mode === 'deposit' ? 'Deposit Collateral' : 'Withdraw Collateral'}
                        </button>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
