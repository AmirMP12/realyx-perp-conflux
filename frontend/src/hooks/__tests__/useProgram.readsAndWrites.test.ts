import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useUSDCDecimals,
    useMarginMode,
    useAllowance,
    useClosePosition,
    useModifyMargin,
    useSetStopLoss,
    useSetTakeProfit,
    usePartialClose,
    useCancelOrder,
    calculatePnL,
} from '../useProgram';
import { useReadContract, useAccount, useWriteContract, usePublicClient } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('../useSound', () => ({
    useSound: vi.fn(() => ({ playSuccess: vi.fn(), playError: vi.fn() })),
}));

describe('useProgram reads and writes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1, isConnected: true });
        (useReadContract as any).mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
    });

    describe('useUSDCDecimals', () => {
        it('defaults to 6 when no data', () => {
            const { result } = renderHook(() => useUSDCDecimals());
            expect(result.current.decimals).toBe(6);
        });
        it('uses returned decimals', () => {
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'decimals') return { data: 18 };
                return { data: undefined };
            });
            const { result } = renderHook(() => useUSDCDecimals());
            expect(result.current.decimals).toBe(18);
        });
    });

    describe('useMarginMode', () => {
        it('defaults to cross before data resolves', () => {
            (useReadContract as any).mockReturnValue({ data: undefined, isLoading: true });
            const { result } = renderHook(() => useMarginMode());
            expect(result.current.isCross).toBe(true);
            expect(result.current.mode).toBe('cross');
        });
        it('reflects isolated mode when false', () => {
            (useReadContract as any).mockReturnValue({ data: false, isLoading: false });
            const { result } = renderHook(() => useMarginMode());
            expect(result.current.isCross).toBe(false);
            expect(result.current.mode).toBe('isolated');
        });
    });

    describe('useAllowance', () => {
        it('returns allowance value', () => {
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'allowance') return { data: 123n, refetch: vi.fn(), isLoading: false };
                return { data: undefined, refetch: vi.fn() };
            });
            const { result } = renderHook(() => useAllowance());
            expect(result.current.allowance).toBe(123n);
        });
    });

    describe('useClosePosition', () => {
        it('errors when wallet not connected', async () => {
            (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn(), isPending: false });
            const { result } = renderHook(() => useClosePosition());
            let ok;
            await act(async () => { ok = await result.current.closePosition(1); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Wallet not connected'));
        });

        it('errors when no chainId', async () => {
            (useAccount as any).mockReturnValue({ address: '0xUser', chainId: undefined });
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn(), isPending: false });
            const { result } = renderHook(() => useClosePosition());
            let ok;
            await act(async () => { ok = await result.current.closePosition(1); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Network not detected'));
        });

        it('returns true on success', async () => {
            const write = vi.fn().mockResolvedValue('0xhash');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
            const { result } = renderHook(() => useClosePosition());
            let ok;
            await act(async () => { ok = await result.current.closePosition('5'); });
            expect(ok).toBe(true);
            expect(write).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'closePosition' }));
        });

        it('handles user rejection (4001)', async () => {
            const write = vi.fn().mockRejectedValue({ code: 4001 });
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
            const { result } = renderHook(() => useClosePosition());
            await act(async () => { await result.current.closePosition(1); });
            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('rejected'));
        });

        it('handles authorization error (4100)', async () => {
            const write = vi.fn().mockRejectedValue({ code: 4100 });
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
            const { result } = renderHook(() => useClosePosition());
            await act(async () => { await result.current.closePosition(1); });
            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('authorization failed'));
        });

        it('maps generic revert', async () => {
            const write = vi.fn().mockRejectedValue(new Error('StalePrice'));
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
            const { result } = renderHook(() => useClosePosition());
            await act(async () => { await result.current.closePosition(1); });
            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('stale'));
        });
    });

    describe('useModifyMargin', () => {
        function setup({ allowance }: { allowance?: bigint } = {}) {
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'usdc') return { data: '0xUSDC' };
                if (functionName === 'allowance') return { data: allowance, refetch: vi.fn().mockResolvedValue({ data: allowance }), isLoading: false };
                return { data: undefined, refetch: vi.fn() };
            });
            const write = vi.fn().mockResolvedValue('0xhash');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write });
            (usePublicClient as any).mockReturnValue({ waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }) });
            return write;
        }

        it('approves then adds collateral when allowance insufficient', async () => {
            const write = setup({ allowance: 0n });
            const { result } = renderHook(() => useModifyMargin());
            await act(async () => { await result.current.modifyMargin(1, 100); });
            const fns = write.mock.calls.map((c) => c[0].functionName);
            expect(fns).toContain('approve');
            expect(fns).toContain('addCollateral');
        });

        it('skips approval when allowance sufficient', async () => {
            const write = setup({ allowance: 10n ** 18n });
            const { result } = renderHook(() => useModifyMargin());
            await act(async () => { await result.current.modifyMargin(1, 1); });
            const fns = write.mock.calls.map((c) => c[0].functionName);
            expect(fns).not.toContain('approve');
            expect(fns).toContain('addCollateral');
        });

        it('withdraws collateral for negative delta', async () => {
            const write = setup({ allowance: 10n ** 18n });
            const { result } = renderHook(() => useModifyMargin());
            await act(async () => { await result.current.modifyMargin(1, -50); });
            expect(write).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'withdrawCollateral' }));
        });

        it('toasts error on failure', async () => {
            setup({ allowance: 10n ** 18n });
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ message: 'boom' }) });
            const { result } = renderHook(() => useModifyMargin());
            await act(async () => { await result.current.modifyMargin(1, -50); });
            expect(toast.error).toHaveBeenCalledWith('boom');
        });
    });

    describe('useSetStopLoss / useSetTakeProfit clear paths', () => {
        it('clears stop loss at price 0', async () => {
            const write = vi.fn().mockResolvedValue('0x');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
            const { result } = renderHook(() => useSetStopLoss());
            await act(async () => { await result.current.setStopLoss(1, 0); });
            expect(toast.success).toHaveBeenCalledWith('Stop loss cleared');
        });

        it('clears take profit at price 0', async () => {
            const write = vi.fn().mockResolvedValue('0x');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
            const { result } = renderHook(() => useSetTakeProfit());
            await act(async () => { await result.current.setTakeProfit(1, 0); });
            expect(toast.success).toHaveBeenCalledWith('Take profit cleared');
        });
    });

    describe('usePartialClose validation', () => {
        beforeEach(() => {
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockResolvedValue('0x'), isPending: false });
            (usePublicClient as any).mockReturnValue({ readContract: vi.fn().mockResolvedValue(null) });
        });

        it('rejects when wallet not connected', async () => {
            (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
            const { result } = renderHook(() => usePartialClose());
            let ok;
            await act(async () => { ok = await result.current.partialClose(1, 50, '1000'); });
            expect(ok).toBe(false);
        });

        it('rejects when no chainId', async () => {
            (useAccount as any).mockReturnValue({ address: '0xUser', chainId: undefined });
            const { result } = renderHook(() => usePartialClose());
            let ok;
            await act(async () => { ok = await result.current.partialClose(1, 50, '1000'); });
            expect(ok).toBe(false);
        });

        it('rejects invalid percent', async () => {
            const { result } = renderHook(() => usePartialClose());
            let ok;
            await act(async () => { ok = await result.current.partialClose(1, 0, '1000'); });
            expect(ok).toBe(false);
            await act(async () => { ok = await result.current.partialClose(1, 150, '1000'); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('between 1% and 99%'));
        });
    });

    describe('useCancelOrder error path', () => {
        it('toasts error and returns false on failure', async () => {
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ shortMessage: 'cannot cancel' }), isPending: false });
            const { result } = renderHook(() => useCancelOrder());
            let ok;
            await act(async () => { ok = await result.current.cancelOrder(1); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('cannot cancel');
        });
    });

    describe('calculatePnL edge cases', () => {
        it('returns zero for null position', () => {
            expect(calculatePnL(null, 100)).toEqual({ pnl: 0, pnlPercent: 0 });
        });
        it('returns zero when entry price is zero', () => {
            expect(calculatePnL({ entryPrice: 0, size: 1, margin: 1, isLong: true }, 100)).toEqual({ pnl: 0, pnlPercent: 0 });
        });
        it('computes short pnl', () => {
            const { pnl } = calculatePnL({ size: 1, entryPrice: 100, margin: 10, isLong: false }, 90);
            expect(pnl).toBeCloseTo(0.1);
        });
        it('returns 0 percent when margin is zero', () => {
            const { pnlPercent } = calculatePnL({ size: 1, entryPrice: 100, margin: 0, isLong: true }, 110);
            expect(pnlPercent).toBe(0);
        });
    });
});
