import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVaultDeposit, useVaultWithdraw, useStakeInsurance, useUnstakeInsurance } from '../useVault';
import { useReadContract, useWriteContract, usePublicClient, useAccount } from 'wagmi';
import { useUSDC } from '../useProgram';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(), useReadContract: vi.fn(), useWriteContract: vi.fn(), usePublicClient: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(() => ({ data: undefined, isFetched: false })) }));
vi.mock('../useProgram', () => ({
    VAULT_CORE_ADDRESS: '0xVault', VAULT_ABI: [], useUSDC: vi.fn(),
}));

describe('useVault guards and fallbacks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1 });
        (useReadContract as any).mockReturnValue({ data: 6 });
        (usePublicClient as any).mockReturnValue({
            readContract: vi.fn().mockResolvedValue(0n),
            waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
        });
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockResolvedValue('0x'), isPending: false });
        (useUSDC as any).mockReturnValue({ address: '0xUSDC' });
    });

    it('deposit errors when the USDT0 address is missing', async () => {
        (useUSDC as any).mockReturnValue({ address: undefined });
        const { result } = renderHook(() => useVaultDeposit());
        let ok; await act(async () => { ok = await result.current.deposit(10); });
        expect(ok).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('USDT0 address not found');
    });

    it('stake errors when the USDT0 address is missing', async () => {
        (useUSDC as any).mockReturnValue({ address: undefined });
        const { result } = renderHook(() => useStakeInsurance());
        let ok; await act(async () => { ok = await result.current.stake(10); });
        expect(ok).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('USDT0 address not found');
    });

    it('deposit uses the default message when the error has no fields', async () => {
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({}) });
        const { result } = renderHook(() => useVaultDeposit());
        await act(async () => { await result.current.deposit(10); });
        expect(toast.error).toHaveBeenCalledWith('Deposit failed');
    });

    it('withdraw uses the default message when the error has no message', async () => {
        (usePublicClient as any).mockReturnValue({ readContract: vi.fn().mockResolvedValue(1000n) });
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({}) });
        const { result } = renderHook(() => useVaultWithdraw());
        await act(async () => { await result.current.withdraw(10); });
        expect(toast.error).toHaveBeenCalledWith('Withdrawal failed');
    });

    it('stake uses the default message when the error has no fields', async () => {
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({}) });
        const { result } = renderHook(() => useStakeInsurance());
        await act(async () => { await result.current.stake(10); });
        expect(toast.error).toHaveBeenCalledWith('Stake failed');
    });

    it('unstake uses the default message when the error has no fields or hint', async () => {
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({}) });
        const { result } = renderHook(() => useUnstakeInsurance());
        await act(async () => { await result.current.unstake(10); });
        expect(toast.error).toHaveBeenCalledWith('Unstake failed');
    });
});
