
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePythOnChainUpdater } from '../usePythOnChainUpdater';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    usePublicClient: vi.fn(),
    useWriteContract: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: Object.assign(vi.fn(), {
        error: vi.fn(),
        success: vi.fn(),
        loading: vi.fn(),
    }),
}));

vi.mock('../contracts', () => ({
    ORACLE_ABI: [],
    ORACLE_AGGREGATOR_ADDRESS: '0x0000000000000000000000000000000000000000',
    TRADING_CORE_ADDRESS: '0xCore',
    TRADING_CORE_ABI: [],
}));

describe('usePythOnChainUpdater', () => {
    const mockWriteContractAsync = vi.fn();
    const mockReadContract = vi.fn();
    const mockPublicClient = {
        readContract: mockReadContract,
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1, isConnected: true });
        (usePublicClient as any).mockReturnValue(mockPublicClient);
        mockWriteContractAsync.mockResolvedValue('0xHash');
        (useWriteContract as any).mockReturnValue({
            writeContractAsync: mockWriteContractAsync,
            isPending: false,
        });
        
        // Mock fetch for Hermes
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ binary: { data: ['0x123'] } }),
        }));
    });

    it('returns idle state by default', () => {
        const { result } = renderHook(() => usePythOnChainUpdater());
        expect(result.current.isPending).toBe(false);
    });

    it('fails if not connected', async () => {
        (useAccount as any).mockReturnValue({ isConnected: false });
        const { result } = renderHook(() => usePythOnChainUpdater());
        
        const success = await result.current.pushLatestForMarkets(['0x0000000000000000000000000000000000000001']);
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Connect your wallet'));
    });

    it('fails if publicClient is missing', async () => {
        (usePublicClient as any).mockReturnValue(null);
        const { result } = renderHook(() => usePythOnChainUpdater());
        
        const success = await result.current.pushLatestForMarkets(['0x0000000000000000000000000000000000000001']);
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Network not ready'));
    });

    it('handles empty input list', async () => {
        const { result } = renderHook(() => usePythOnChainUpdater());
        const success = await result.current.pushLatestForMarkets([]);
        expect(success).toBe(true); // Should return early but "succeed"
    });

    it('executes full update flow successfully', async () => {
        mockReadContract.mockImplementation(({ functionName }) => {
            if (functionName === 'pyth') return '0xPyth';
            if (functionName === 'getOracleConfig') return { feedId: '0xFeed' };
            if (functionName === 'getUpdateFee') return 100n;
            return '0xAggregator';
        });

        const { result } = renderHook(() => usePythOnChainUpdater());
        
        let success;
        await act(async () => {
            success = await result.current.pushLatestForMarkets(['0x0000000000000000000000000000000000000001']);
        });

        expect(success).toBe(true);
        expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({
            address: '0xPyth',
            functionName: 'updatePriceFeeds',
            value: 100n,
        }));
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('updated'), expect.anything());
    });

    it('handles Hermes fetch failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
        }));
        
        mockReadContract.mockImplementation(({ functionName }) => {
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve({ feedId: '0x0000000000000000000000000000000000000000000000000000000000000001' });
            return Promise.resolve('0xAggregator');
        });

        const { result } = renderHook(() => usePythOnChainUpdater());
        let success;
        await act(async () => {
            success = await result.current.pushLatestForMarkets(['0x0000000000000000000000000000000000000001']);
        });
        
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Hermes 500'));
    });

    it('handles malformed OracleConfig shapes', async () => {
        mockReadContract.mockImplementation(({ functionName }) => {
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve(['0x0000000000000000000000000000000000000000000000000000000000000001']);
            return Promise.resolve('0xAggregator');
        });

        const { result } = renderHook(() => usePythOnChainUpdater());
        await act(async () => {
            await result.current.pushLatestForMarkets(['0x0000000000000000000000000000000000000001']);
        });
        
        expect(global.fetch).toHaveBeenCalled();
    });

    it('handles catch block for generic errors', async () => {
        mockReadContract.mockRejectedValue(new Error('RPC Timeout'));
        
        const { result } = renderHook(() => usePythOnChainUpdater());
        let success;
        await act(async () => {
            success = await result.current.pushLatestForMarkets(['0x0000000000000000000000000000000000000001']);
        });
        
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('RPC Timeout');
    });

    it('handles zero feed or no feed configured', async () => {
        mockReadContract.mockImplementation(({ functionName }) => {
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve(null);
            return Promise.resolve('0xAggregator');
        });

        const { result } = renderHook(() => usePythOnChainUpdater());
        let success;
        await act(async () => {
            success = await result.current.pushLatestForMarkets(['0x0000000000000000000000000000000000000001']);
        });
        
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('No Pyth feed configured'));
    });
});
