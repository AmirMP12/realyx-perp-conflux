import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { 
    useVaultDeposit, 
    useVaultWithdraw, 
    useVaultStats, 
    useInsuranceFund,
    useStakeInsurance,
    useUnstakeInsurance,
    useInsuranceUnstakeStatus,
    messageForUnstakeRevert
} from '../useVault';
import { useReadContract, useWriteContract, usePublicClient, useAccount } from 'wagmi';

// wagmi is mocked globally in setup.ts

// Mock useProgram
vi.mock('../useProgram', () => ({
    VAULT_CORE_ADDRESS: '0xVault',
    VAULT_ABI: [],
    useUSDC: () => ({ address: '0xUSDC' }),
}));

describe('useVault hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAccount).mockReturnValue({ address: '0xUser', isConnected: true, chainId: 1 } as any);
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
            (usePublicClient as any).mockReturnValue({ 
                readContract: mockRead,
                simulateContract: vi.fn().mockImplementation((args: any) => Promise.resolve({ request: args })),
            });

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
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'totalAssets') return { data: BigInt(1000 * 1e18), isLoading: false, isSuccess: true, isFetched: true }; // 1000 USDC
                if (functionName === 'decimals') return { data: 6, isLoading: false, isSuccess: true, isFetched: true };
                return { data: undefined, isLoading: false, isSuccess: true, isFetched: true };
            });
            const { result } = renderHook(() => useVaultStats());
            expect(result.current.stats.tvl).toBe(1000);
        });
    });

    describe('useInsuranceFund', () => {
        it('returns insurance stats', () => {
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'decimals') return { data: 6, isLoading: false };
                if (functionName === 'insuranceAssets') return { data: BigInt(5000000), isLoading: false };
                return { data: undefined, isLoading: false };
            });
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

    describe('messageForUnstakeRevert', () => {
        it('maps known selectors to human messages', () => {
            expect(messageForUnstakeRevert({ data: '0x30c6feeb' })).toContain('Start the unstake timer');
            expect(messageForUnstakeRevert({ data: '0x88dd9788' })).toContain('waiting period is not over');
            expect(messageForUnstakeRevert({ data: '0x39996567' })).toContain('Not enough insurance shares');
            expect(messageForUnstakeRevert({ cause: { data: '0xfe7cb88a' } })).toContain('minimum health ratio');
            expect(messageForUnstakeRevert({ data: '0x12345678' })).toBeUndefined();
        });
    });

    describe('useInsuranceUnstakeStatus', () => {
        it('returns loading phase initially', () => {
            (useReadContract as any).mockReturnValue({ data: undefined, isLoading: true, isFetched: false });
            const { result } = renderHook(() => useInsuranceUnstakeStatus());
            expect(result.current.phase).toBe('loading');
        });

        it('returns need_request when requestAt is 0', () => {
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'unstakeRequestTime') return { data: 0n, isSuccess: true, isFetched: true };
                if (functionName === 'unstakeCooldown') return { data: 3600n, isFetched: true };
                return { data: undefined };
            });
            const { result } = renderHook(() => useInsuranceUnstakeStatus());
            expect(result.current.phase).toBe('need_request');
        });

        it('returns cooldown when time is remaining', () => {
            const now = Math.floor(Date.now() / 1000);
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'unstakeRequestTime') return { data: BigInt(now - 1800), isSuccess: true, isFetched: true };
                if (functionName === 'unstakeCooldown') return { data: 3600n, isFetched: true };
                return { data: undefined };
            });
            const { result } = renderHook(() => useInsuranceUnstakeStatus());
            expect(result.current.phase).toBe('cooldown');
            expect(result.current.unlockAtSec).toBe(now + 1800);
        });

        it('returns ready when cooldown is over', () => {
            const now = Math.floor(Date.now() / 1000);
            (useReadContract as any).mockImplementation(({ functionName }: any) => {
                if (functionName === 'unstakeRequestTime') return { data: BigInt(now - 4000), isSuccess: true, isFetched: true };
                if (functionName === 'unstakeCooldown') return { data: 3600n, isFetched: true };
                return { data: undefined };
            });
            const { result } = renderHook(() => useInsuranceUnstakeStatus());
            expect(result.current.phase).toBe('ready');
        });
    });

    describe('useVaultStats Timer', () => {
        it('sets timedOut after 5s', async () => {
            vi.useFakeTimers();
            (useReadContract as any).mockReturnValue({ data: undefined, isLoading: true });
            
            const { result } = renderHook(() => useVaultStats());
            expect(result.current.loading).toBe(true);
            
            act(() => {
                vi.advanceTimersByTime(5001);
            });
            
            expect(result.current.loading).toBe(false);
            vi.useRealTimers();
        });
    });
});
