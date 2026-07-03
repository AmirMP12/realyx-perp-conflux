import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePythOnChainUpdater } from '../usePythOnChainUpdater';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), usePublicClient: vi.fn(), useWriteContract: vi.fn() }));
// Non-zero oracle aggregator -> resolveOracle returns it directly without reading TradingCore.
vi.mock('../../contracts', () => ({
    ORACLE_ABI: [], ORACLE_AGGREGATOR_ADDRESS: '0x9999999999999999999999999999999999999999',
    TRADING_CORE_ADDRESS: '0xCore', TRADING_CORE_ABI: [],
}));

const MARKET = '0x1234567890123456789012345678901234567890';

describe('usePythOnChainUpdater with a preset oracle aggregator', () => {
    let writeContractAsync: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ binary: { data: ['ff'] } }) });
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1, isConnected: true });
        writeContractAsync = vi.fn().mockResolvedValue('0xhash');
        (useWriteContract as any).mockReturnValue({ writeContractAsync, isPending: false });
    });

    it('resolves the oracle directly and pushes prices', async () => {
        const readContract = vi.fn(({ functionName }: any) => {
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve({ feedId: '0xfeed' });
            if (functionName === 'getUpdateFee') return Promise.resolve(5n);
            return Promise.resolve(undefined);
        });
        (usePublicClient as any).mockReturnValue({ readContract, waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }) });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(true);
        // Should NOT have read oracleAggregator from TradingCore.
        expect(readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: 'oracleAggregator' }));
    });

    it('ignores configs with a null/odd feed id shape', async () => {
        const readContract = vi.fn(({ functionName }: any) => {
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve([12345]); // array, non-string first elem -> null feed
            return Promise.resolve(undefined);
        });
        (usePublicClient as any).mockReturnValue({ readContract, waitForTransactionReceipt: vi.fn() });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false); // no feeds configured
    });

    it('truncates a very long error message in the catch handler', async () => {
        const longMsg = 'x'.repeat(300);
        const readContract = vi.fn(() => { throw new Error(longMsg); });
        (usePublicClient as any).mockReturnValue({ readContract, waitForTransactionReceipt: vi.fn() });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });
});
