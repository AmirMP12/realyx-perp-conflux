import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePythOnChainUpdater } from '../usePythOnChainUpdater';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), usePublicClient: vi.fn(), useWriteContract: vi.fn() }));
// ORACLE_AGGREGATOR_ADDRESS is the zero address -> forces the resolveOracle fallback
// that reads `oracleAggregator()` from TradingCore.
vi.mock('../../contracts', () => ({
    ORACLE_ABI: [], ORACLE_AGGREGATOR_ADDRESS: '0x0000000000000000000000000000000000000000',
    TRADING_CORE_ADDRESS: '0xCore', TRADING_CORE_ABI: [],
}));

const MARKET = '0x1234567890123456789012345678901234567890';

describe('usePythOnChainUpdater oracle fallback + config shapes', () => {
    let writeContractAsync: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ binary: { data: ['ff'] } }) });
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1, isConnected: true });
        writeContractAsync = vi.fn().mockResolvedValue('0xhash');
        (useWriteContract as any).mockReturnValue({ writeContractAsync, isPending: false });
    });

    it('resolves the oracle via TradingCore and accepts an array-shaped config', async () => {
        const readContract = vi.fn(({ functionName }: any) => {
            if (functionName === 'oracleAggregator') return Promise.resolve('0xResolvedOracle');
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve(['0xfeedArray']); // array shape
            if (functionName === 'getUpdateFee') return Promise.resolve(7n);
            return Promise.resolve(undefined);
        });
        (usePublicClient as any).mockReturnValue({ readContract, waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }) });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET, 'not-an-address', MARKET]); });
        expect(ok).toBe(true);
        expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'oracleAggregator' }));
    });

    it('returns false when network is not ready', async () => {
        (usePublicClient as any).mockReturnValue(undefined);
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });

    it('returns false and toasts when Hermes fetch throws', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('hermes down'));
        const readContract = vi.fn(({ functionName }: any) => {
            if (functionName === 'oracleAggregator') return Promise.resolve('0xResolvedOracle');
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve({ feedId: '0xfeed' });
            return Promise.resolve(undefined);
        });
        (usePublicClient as any).mockReturnValue({ readContract, waitForTransactionReceipt: vi.fn() });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });
});
