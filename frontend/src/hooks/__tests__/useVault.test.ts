import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { 
    useVaultDeposit, 
    useVaultWithdraw, 
    useVaultStats, 
    useInsuranceFund,
    useStakeInsurance,
    useUnstakeInsurance
} from '../useVault';
import { useReadContract, useWriteContract, usePublicClient } from 'wagmi';

// Mock wagmi
vi.mock('wagmi', () => ({
    useAccount: vi.fn(() => ({ address: '0xUser', isConnected: true, chainId: 1 })),
    useReadContract: vi.fn(() => ({ data: undefined, isLoading: false })),
    useWriteContract: vi.fn(() => ({ writeContractAsync: vi.fn(), isPending: false })),
    usePublicClient: vi.fn(() => ({ readContract: vi.fn() })),
}));

// Mock useProgram
vi.mock('../useProgram', () => ({
    VAULT_CORE_ADDRESS: '0xVault',
    VAULT_ABI: [],
    useUSDC: vi.fn(() => ({ address: '0xUSDC' })),
}));

describe('useVault hooks - Full Coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('useVaultDeposit', () => {
        it('calls approve and deposit', async () => {
            const mockWrite = vi.fn().mockResolvedValue('0xHash');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            
            const { result } = renderHook(() => useVaultDeposit());
            await act(async () => {
                await result.current.deposit(100);
            });
            
            // Should call approve then deposit
            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockWrite.mock.calls[0][0].functionName).toBe('approve');
            expect(mockWrite.mock.calls[1][0].functionName).toBe('deposit');
        });
    });

    describe('useVaultWithdraw', () => {
        it('calls convertToShares and withdraw', async () => {
            const mockWrite = vi.fn().mockResolvedValue('0xHash');
            const mockRead = vi.fn().mockResolvedValue(BigInt(1000));
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            (usePublicClient as any).mockReturnValue({ readContract: mockRead });

            const { result } = renderHook(() => useVaultWithdraw());
            await act(async () => {
                await result.current.withdraw(100);
            });

            expect(mockRead).toHaveBeenCalled();
            expect(mockWrite).toHaveBeenCalled();
            expect(mockWrite.mock.calls[0][0].functionName).toBe('withdraw');
        });
    });

    describe('useVaultStats', () => {
        it('calculates stats correctly', () => {
            (useReadContract as any).mockReturnValue({ data: BigInt(1000000000), isLoading: false }); // 1000 USDC
            const { result } = renderHook(() => useVaultStats());
            expect(result.current.stats.tvl).toBe(1000);
        });
    });

    describe('useInsuranceFund', () => {
        it('returns insurance stats', () => {
            (useReadContract as any).mockReturnValue({ data: BigInt(5000000), isLoading: false }); // 5 USDC
            const { result } = renderHook(() => useInsuranceFund());
            expect(result.current.insuranceAssets).toBe(5);
        });
    });

    describe('useStakeInsurance', () => {
        it('calls stakeInsurance', async () => {
            const mockWrite = vi.fn().mockResolvedValue('0xHash');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            
            const { result } = renderHook(() => useStakeInsurance());
            await act(async () => {
                await result.current.stake(100);
            });
            
            expect(mockWrite).toHaveBeenCalled();
            expect(mockWrite.mock.calls[1][0].functionName).toBe('stakeInsurance');
        });
    });

    describe('useUnstakeInsurance', () => {
        it('calls unstakeInsurance', async () => {
            const mockWrite = vi.fn().mockResolvedValue('0xHash');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            
            const { result } = renderHook(() => useUnstakeInsurance());
            await act(async () => {
                await result.current.unstake(100);
            });
            
            expect(mockWrite).toHaveBeenCalled();
            expect(mockWrite.mock.calls[0][0].functionName).toBe('unstakeInsurance');
        });
    });
});
