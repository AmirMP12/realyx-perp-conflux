import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGovernance } from '../useGovernance';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        useAccount: vi.fn(),
    };
});

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
        loading: vi.fn(),
    },
}));

describe('useGovernance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (useAccount as any).mockReturnValue({ address: '0x123' });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should show error if disconnected on createProposal', async () => {
        (useAccount as any).mockReturnValue({ address: undefined });
        const { result } = renderHook(() => useGovernance());
        
        const success = await result.current.createProposal({ type: 'EmergencyPause' }, 'desc');
        expect(success).toBeNull();
        expect(toast.error).toHaveBeenCalledWith('Please connect your wallet');
    });

    it('should create proposal successfully after delay', async () => {
        const { result } = renderHook(() => useGovernance());
        
        const promise = result.current.createProposal({ type: 'EmergencyPause' }, 'desc');
        
        // Should show loading
        expect(toast.loading).toHaveBeenCalled();
        
        // Advance time
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        
        const signature = await promise;
        expect(signature).toBe('demo-tx-signature');
        expect(toast.success).toHaveBeenCalledWith('Proposal created successfully!', expect.anything());
    });

    it('should handle errors in createProposal', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useGovernance());
        
        vi.spyOn(global, 'setTimeout').mockImplementationOnce(() => {
            throw new Error('Async error');
        });

        const signature = await result.current.createProposal({ type: 'EmergencyPause' }, 'desc');
        expect(signature).toBeNull();
        expect(toast.error).toHaveBeenCalledWith('Async error', expect.anything());
        consoleSpy.mockRestore();
    });

    it('should approve proposal successfully', async () => {
        const { result } = renderHook(() => useGovernance());
        const promise = result.current.approveProposal(1);
        
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        
        const success = await promise;
        expect(success).toBe(true);
        expect(toast.success).toHaveBeenCalledWith('Proposal approved!', expect.anything());
    });

    it('should execute proposal successfully', async () => {
        const { result } = renderHook(() => useGovernance());
        const promise = result.current.executeProposal(1);
        
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        
        const success = await promise;
        expect(success).toBe(true);
        expect(toast.success).toHaveBeenCalledWith('Proposal executed!', expect.anything());
    });

    it('should initiate emergency pause successfully', async () => {
        const { result } = renderHook(() => useGovernance());
        const promise = result.current.emergencyPause();
        
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        
        const success = await promise;
        expect(success).toBe(true);
        expect(toast.success).toHaveBeenCalledWith('Emergency pause activated!', expect.anything());
    });

    describe('propose helpers', () => {
        it('proposeAddMarket calls createProposal', async () => {
            const { result } = renderHook(() => useGovernance());
            const promise = result.current.proposeAddMarket({ name: 'Test' } as any, 'desc');
            
            await act(async () => {
                vi.advanceTimersByTime(1000);
            });
            
            const sig = await promise;
            expect(sig).toBe('demo-tx-signature');
        });

        it('proposeUpdateFee calls createProposal', async () => {
             const { result } = renderHook(() => useGovernance());
             const promise = result.current.proposeUpdateFee(100, 'desc');
             
             await act(async () => {
                 vi.advanceTimersByTime(1000);
             });
             
             expect(await promise).toBe('demo-tx-signature');
        });

        it('proposeUpdateSigners calls createProposal', async () => {
            const { result } = renderHook(() => useGovernance());
            const promise = result.current.proposeUpdateSigners(['0x1'], 1, 'desc');
            
            await act(async () => {
                vi.advanceTimersByTime(1000);
            });
            
            expect(await promise).toBe('demo-tx-signature');
        });
    });

    describe('disconnected scenarios', () => {
        beforeEach(() => {
            (useAccount as any).mockReturnValue({ address: undefined });
        });

        it('approveProposal returns false if disconnected', async () => {
            const { result } = renderHook(() => useGovernance());
            const success = await result.current.approveProposal(1);
            expect(success).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('Please connect your wallet');
        });

        it('executeProposal returns false if disconnected', async () => {
            const { result } = renderHook(() => useGovernance());
            const success = await result.current.executeProposal(1);
            expect(success).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('Please connect your wallet');
        });

        it('emergencyPause returns false if disconnected', async () => {
            const { result } = renderHook(() => useGovernance());
            const success = await result.current.emergencyPause();
            expect(success).toBe(false);
            expect(toast.error).toHaveBeenCalledWith('Please connect your wallet');
        });
    });
});
