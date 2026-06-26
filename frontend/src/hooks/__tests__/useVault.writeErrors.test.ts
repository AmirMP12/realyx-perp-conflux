import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useVaultDeposit,
    useVaultWithdraw,
    useStakeInsurance,
    useUnstakeInsurance,
    useRequestUnstake,
} from '../useVault';
import { useReadContract, useWriteContract, usePublicClient, useAccount } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    useReadContract: vi.fn(),
    useWriteContract: vi.fn(),
    usePublicClient: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(() => ({ data: undefined, isFetched: false })) }));

vi.mock('../useProgram', () => ({
    VAULT_CORE_ADDRESS: '0xVault',
    VAULT_ABI: [],
    useUSDC: () => ({ address: '0xUSDC' }),
}));

describe('useVault write errors', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1 });
        (useReadContract as any).mockReturnValue({ data: 6 }); // decimals
        (usePublicClient as any).mockReturnValue({
            readContract: vi.fn().mockResolvedValue(0n),
            waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
        });
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockResolvedValue('0x'), isPending: false });
    });

    describe('useVaultDeposit', () => {
        it('errors when wallet not connected', async () => {
            (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
            const { result } = renderHook(() => useVaultDeposit());
            let ok;
            await act(async () => { ok = await result.current.deposit(100); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('Connect wallet');
        });

        it('skips approve when allowance is sufficient', async () => {
            const write = vi.fn().mockResolvedValue('0x');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write });
            (usePublicClient as any).mockReturnValue({
                readContract: vi.fn().mockResolvedValue(10n ** 30n),
                waitForTransactionReceipt: vi.fn(),
            });
            const { result } = renderHook(() => useVaultDeposit());
            await act(async () => { await result.current.deposit(1); });
            const fns = write.mock.calls.map((c) => c[0].functionName);
            expect(fns).not.toContain('approve');
            expect(fns).toContain('deposit');
        });

        it('returns false and toasts on failure', async () => {
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ shortMessage: 'rejected' }) });
            const { result } = renderHook(() => useVaultDeposit());
            let ok;
            await act(async () => { ok = await result.current.deposit(100); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('rejected');
        });
    });

    describe('useVaultWithdraw', () => {
        it('errors when no public client', async () => {
            (usePublicClient as any).mockReturnValue(undefined);
            const { result } = renderHook(() => useVaultWithdraw());
            let ok;
            await act(async () => { ok = await result.current.withdraw(10); });
            expect(ok).toBe(false);
        });

        it('returns false on revert', async () => {
            (usePublicClient as any).mockReturnValue({ readContract: vi.fn().mockResolvedValue(1000n) });
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue(new Error('no liquidity')) });
            const { result } = renderHook(() => useVaultWithdraw());
            let ok;
            await act(async () => { ok = await result.current.withdraw(10); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('no liquidity');
        });
    });

    describe('useStakeInsurance', () => {
        it('errors when not connected', async () => {
            (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
            const { result } = renderHook(() => useStakeInsurance());
            let ok;
            await act(async () => { ok = await result.current.stake(10); });
            expect(ok).toBe(false);
        });

        it('returns false on failure', async () => {
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ message: 'stake bad' }) });
            const { result } = renderHook(() => useStakeInsurance());
            let ok;
            await act(async () => { ok = await result.current.stake(10); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('stake bad');
        });
    });

    describe('useUnstakeInsurance', () => {
        it('errors when not connected', async () => {
            (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
            const { result } = renderHook(() => useUnstakeInsurance());
            let ok;
            await act(async () => { ok = await result.current.unstake(10); });
            expect(ok).toBe(false);
        });

        it('caps shares at maxSharesWei', async () => {
            const write = vi.fn().mockResolvedValue('0x');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write });
            const { result } = renderHook(() => useUnstakeInsurance());
            await act(async () => { await result.current.unstake(100, 5n); });
            expect(write.mock.calls[0][0].args[0]).toBe(5n);
        });

        it('rejects amount that rounds to zero', async () => {
            const { result } = renderHook(() => useUnstakeInsurance());
            let ok;
            await act(async () => { ok = await result.current.unstake(0, 0n); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('Amount too small');
        });

        it('shows mapped hint on revert', async () => {
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ data: '0x88dd9788' }) });
            const { result } = renderHook(() => useUnstakeInsurance());
            await act(async () => { await result.current.unstake(10); });
            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('waiting period is not over'));
        });
    });

    describe('useRequestUnstake', () => {
        it('errors when not connected', async () => {
            (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
            const { result } = renderHook(() => useRequestUnstake());
            let ok;
            await act(async () => { ok = await result.current.requestUnstake(); });
            expect(ok).toBe(false);
        });

        it('calls requestUnstake and onSettled callback', async () => {
            const onSettled = vi.fn();
            const write = vi.fn().mockResolvedValue('0x');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
            const { result } = renderHook(() => useRequestUnstake(onSettled));
            let ok;
            await act(async () => { ok = await result.current.requestUnstake(); });
            expect(ok).toBe(true);
            expect(write).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'requestUnstake' }));
            expect(onSettled).toHaveBeenCalled();
        });

        it('returns false on failure', async () => {
            (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ shortMessage: 'fail req' }), isPending: false });
            const { result } = renderHook(() => useRequestUnstake());
            let ok;
            await act(async () => { ok = await result.current.requestUnstake(); });
            expect(ok).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('fail req');
        });
    });
});
