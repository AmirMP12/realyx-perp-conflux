import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Info, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useAccount, useWriteContract } from 'wagmi';
import { parseUnits, type Abi } from 'viem';

// ABI fragments needed for the Copy Modal
const USDC_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const TRADING_CORE_ABI = [
  {
    name: 'addSubaccount',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'subaccount', type: 'address' }],
    outputs: [],
  },
] as const;

const COPY_REGISTRY_ABI = [
  {
    name: 'followTrader',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'leadTrader', type: 'address' },
      { name: 'maxAllocation', type: 'uint256' },
      { name: 'maxLeverage', type: 'uint8' },
    ],
    outputs: [],
  },
] as const;

interface CopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadTraderAddress: string;
  leadTraderName?: string;
  profitFeeBps?: number;
  usdcAddress: string;
  tradingCoreAddress: string;
  copyRegistryAddress: string;
  copyBotAddress: string;
}

type SetupStep = 'config' | 'approving' | 'subaccount' | 'following' | 'done';

export function CopyModal({
  isOpen,
  onClose,
  leadTraderAddress,
  leadTraderName,
  profitFeeBps = 0,
  usdcAddress,
  tradingCoreAddress,
  copyRegistryAddress,
  copyBotAddress,
}: CopyModalProps) {
  const { address } = useAccount();

  // Config state
  const [maxAllocation, setMaxAllocation] = useState('1000');
  const [maxLeverage, setMaxLeverage] = useState('30');
  const [setupStep, setSetupStep] = useState<SetupStep>('config');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Contract interactions
  const { writeContractAsync } = useWriteContract();

  const allocationWei = (() => {
    try {
      return parseUnits(maxAllocation || '0', 6); // USDC has 6 decimals
    } catch {
      return 0n;
    }
  })();

  const maxLev = (() => {
    const n = parseInt(maxLeverage, 10);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : 30;
  })();

  const handleSetup = async () => {
    if (!address) return;
    setErrorMsg(null);

    try {
      // Step 1: Approve USDC to TradingCore for the allocation amount
      setSetupStep('approving');
      const approveTx = await writeContractAsync({
        address: usdcAddress as `0x${string}`,
        abi: USDC_ABI as Abi,
        functionName: 'approve',
        args: [tradingCoreAddress as `0x${string}`, allocationWei],
      });
      console.log('[CopyModal] USDC approved:', approveTx);

      // Step 2: Add CopyBot as subaccount
      setSetupStep('subaccount');
      const subaccountTx = await writeContractAsync({
        address: tradingCoreAddress as `0x${string}`,
        abi: TRADING_CORE_ABI as Abi,
        functionName: 'addSubaccount',
        args: [copyBotAddress as `0x${string}`],
      });
      console.log('[CopyModal] Subaccount added:', subaccountTx);

      // Step 3: Follow the lead trader on CopyRegistry
      setSetupStep('following');
      const followTx = await writeContractAsync({
        address: copyRegistryAddress as `0x${string}`,
        abi: COPY_REGISTRY_ABI as Abi,
        functionName: 'followTrader',
        args: [leadTraderAddress as `0x${string}`, allocationWei, maxLev],
      });
      console.log('[CopyModal] Followed trader:', followTx);

      setSetupStep('done');
    } catch (err: any) {
      console.error('[CopyModal] Setup failed:', err);
      setErrorMsg(err?.shortMessage || err?.message || 'Transaction failed');
      setSetupStep('config');
    }
  };

  const stepLabels: Record<SetupStep, string> = {
    config: 'Configure Settings',
    approving: '1/3: Approving USDC Spend...',
    subaccount: '2/3: Authorizing CopyBot...',
    following: '3/3: Confirming Follow...',
    done: 'Setup Complete!',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setupStep === 'config' || setupStep === 'done' ? onClose() : undefined}
          />

          {/* Modal */}
          <motion.div
            className="relative bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-6 z-10"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <Copy className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-text-primary">
                    Copy {leadTraderName || truncateAddress(leadTraderAddress)}
                  </h2>
                  {profitFeeBps > 0 && (
                    <p className="text-xs text-text-muted">
                      Profit Fee: {(profitFeeBps / 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                disabled={setupStep !== 'config' && setupStep !== 'done'}
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>

            {/* Config Step */}
            {setupStep === 'config' && (
              <div className="space-y-5">
                <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] flex items-start gap-2">
                  <Info className="w-4 h-4 text-[var(--primary)] mt-0.5 shrink-0" />
                  <p className="text-xs text-text-secondary leading-relaxed">
                    You will sign <strong>3 transactions</strong>:
                    <br />1. Approve USDC to TradingCore
                    <br />2. Authorize the CopyBot as a subaccount
                    <br />3. Register your follow on-chain
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="text-sm font-medium text-text-secondary">
                      Max Allocation (USDC)
                    </span>
                    <input
                      type="number"
                      value={maxAllocation}
                      onChange={(e) => setMaxAllocation(e.target.value)}
                      className={clsx(
                        'mt-1 w-full rounded-lg border bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-text-primary',
                        'border-[var(--border-color)] focus:border-[var(--primary)] focus:outline-none'
                      )}
                      placeholder="1000"
                      min="1"
                      step="1"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-text-secondary">
                      Max Leverage (1-100x)
                    </span>
                    <input
                      type="number"
                      value={maxLeverage}
                      onChange={(e) => setMaxLeverage(e.target.value)}
                      className={clsx(
                        'mt-1 w-full rounded-lg border bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-text-primary',
                        'border-[var(--border-color)] focus:border-[var(--primary)] focus:outline-none'
                      )}
                      placeholder="30"
                      min="1"
                      max="100"
                      step="1"
                    />
                  </label>
                </div>

                <div className="p-3 rounded-lg bg-orange-400/10 border border-orange-400/20 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-orange-300 leading-relaxed">
                    Copy trading carries risk. The CopyBot will mirror the Lead Trader's
                    positions proportionally to your allocation. Past performance does not
                    guarantee future results.
                  </p>
                </div>

                {errorMsg && (
                  <div className="p-3 rounded-lg bg-red-400/10 border border-red-400/20">
                    <p className="text-xs text-red-400">{errorMsg}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSetup}
                  disabled={!address || !maxAllocation || parseFloat(maxAllocation) <= 0}
                  className={clsx(
                    'w-full py-3 rounded-xl font-bold text-sm transition-all',
                    address && maxAllocation && parseFloat(maxAllocation) > 0
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90'
                      : 'bg-[var(--bg-tertiary)] text-text-muted cursor-not-allowed'
                  )}
                >
                  Start Setup
                </button>
              </div>
            )}

            {/* Progress Steps */}
            {(setupStep === 'approving' ||
              setupStep === 'subaccount' ||
              setupStep === 'following') && (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="w-12 h-12 rounded-full border-4 border-[var(--primary)] border-t-transparent animate-spin" />
                </div>
                <p className="text-center text-sm text-text-secondary">
                  {stepLabels[setupStep]}
                </p>
                <p className="text-center text-xs text-text-muted">
                  Please confirm the transaction in your wallet...
                </p>
              </div>
            )}

            {/* Done Step */}
            {setupStep === 'done' && (
              <div className="space-y-4 text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-green-400/20 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">All Set!</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    You are now copying{' '}
                    {leadTraderName || truncateAddress(leadTraderAddress)}.
                  </p>
                  <p className="text-xs text-text-muted mt-2">
                    New positions will be mirrored automatically at proportional sizes
                    up to your {maxAllocation} USDC allocation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-sm hover:opacity-90 transition-opacity"
                >
                  Got It
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Truncate an Ethereum address for display */
function truncateAddress(address: string) {
  if (!address) return '—';
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}