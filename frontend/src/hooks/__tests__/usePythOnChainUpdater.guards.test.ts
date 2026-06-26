import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePythOnChainUpdater } from '../usePythOnChainUpdater';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), usePublicClient: vi.fn(), useWriteContract: vi.fn() }));
vi.mock('../../contracts', () => ({
    ORACLE_ABI: [], ORACLE_AGGREGATOR_ADDRESS: '0x0000000000000000000000000000000000000000',
    TRADING_CORE_ADDRESS: '0xCore', TRADING_CORE_ABI: [],
}));

const MARKET = '0x1234567890123456789012345678901234567890';
const ZERO_FEED = '0x0000000000000000000000000000000000000000000000000000000000000000';

describe('usePythOnChainUpdater guards', () => {
    let writeContractAsync: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ binary: { data: ['ff'] } }) });
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1, isConnected: true });
        writeContractAsync = vi.fn().mockResolvedValue('0xhash');
        (useWriteContract as any).mockReturnValue({ writeContractAsync, isPending: false });
    });

    it('returns false when the wallet is not connected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined, chainId: 1, isConnected: false });
        (usePublicClient as any).mockReturnValue({ readContract: vi.fn(), waitForTransactionReceipt: vi.fn() });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });

    it('returns true (no-op) when all addresses are invalid', async () => {
        (usePublicClient as any).mockReturnValue({ readContract: vi.fn(), waitForTransactionReceipt: vi.fn() });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets(['nope', 'also-bad']); });
        expect(ok).toBe(true);
    });

    it('returns false when no Pyth feed is configured (zero feed id)', async () => {
        const readContract = vi.fn(({ functionName }: any) => {
            if (functionName === 'oracleAggregator') return Promise.resolve('0xResolvedOracle');
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve({ feedId: ZERO_FEED });
            return Promise.resolve(undefined);
        });
        (usePublicClient as any).mockReturnValue({ readContract, waitForTransactionReceipt: vi.fn() });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });

    it('returns false when Hermes returns no update data', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ binary: { data: [] } }) });
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

    it('returns false when the price-update receipt fails', async () => {
        const readContract = vi.fn(({ functionName }: any) => {
            if (functionName === 'oracleAggregator') return Promise.resolve('0xResolvedOracle');
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve(['0xfeedArray']);
            if (functionName === 'getUpdateFee') return Promise.resolve(7n);
            return Promise.resolve(undefined);
        });
        (usePublicClient as any).mockReturnValue({ readContract, waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timeout')) });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });

    it('handles a Hermes non-OK response by toasting and returning false', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
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
