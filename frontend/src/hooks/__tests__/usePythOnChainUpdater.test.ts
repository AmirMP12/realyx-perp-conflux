import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePythOnChainUpdater } from '../usePythOnChainUpdater';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), usePublicClient: vi.fn(), useWriteContract: vi.fn() }));
vi.mock('../../contracts', () => ({
    ORACLE_ABI: [], ORACLE_AGGREGATOR_ADDRESS: '0xOracle', TRADING_CORE_ADDRESS: '0xCore', TRADING_CORE_ABI: [],
}));

const MARKET = '0x1234567890123456789012345678901234567890';

function makeClient(overrides: Record<string, any> = {}) {
    return {
        readContract: vi.fn(({ functionName }: any) => {
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve({ feedId: '0xfeed1' });
            if (functionName === 'getUpdateFee') return Promise.resolve(123n);
            return Promise.resolve(undefined);
        }),
        waitForTransactionReceipt: overrides.waitForTransactionReceipt ?? vi.fn().mockResolvedValue({ status: 'success' }),
    };
}

describe('usePythOnChainUpdater', () => {
    let writeContractAsync: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ binary: { data: ['abcd'] } }) });
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1, isConnected: true });
        writeContractAsync = vi.fn().mockResolvedValue('0xhash');
        (useWriteContract as any).mockReturnValue({ writeContractAsync, isPending: false });
        (usePublicClient as any).mockReturnValue(makeClient());
    });

    it('returns false when not connected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined, chainId: 1, isConnected: false });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });

    it('returns true for an empty market list', async () => {
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([]); });
        expect(ok).toBe(true);
    });

    it('pushes updates and confirms successfully', async () => {
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(true);
        expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'updatePriceFeeds', value: 123n }));
    });

    it('returns false when the receipt wait fails', async () => {
        (usePublicClient as any).mockReturnValue(makeClient({ waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timeout')) }));
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });

    it('returns false when no feed is configured', async () => {
        const client = makeClient();
        client.readContract = vi.fn(({ functionName }: any) => {
            if (functionName === 'pyth') return Promise.resolve('0xPyth');
            if (functionName === 'getOracleConfig') return Promise.resolve({ feedId: '0x0000000000000000000000000000000000000000000000000000000000000000' });
            return Promise.resolve(undefined);
        });
        (usePublicClient as any).mockReturnValue(client);
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });

    it('returns false when Hermes returns no data', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ binary: { data: [] } }) });
        const { result } = renderHook(() => usePythOnChainUpdater());
        let ok: any;
        await act(async () => { ok = await result.current.pushLatestForMarkets([MARKET]); });
        expect(ok).toBe(false);
    });
});
