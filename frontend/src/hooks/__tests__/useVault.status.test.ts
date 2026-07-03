import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInsuranceUnstakeStatus } from '../useVault';
import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useReadContract: vi.fn(), usePublicClient: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../useProgram', () => ({ VAULT_CORE_ADDRESS: '0xVault', VAULT_ABI: [], useUSDC: () => ({ address: '0xUSDC' }) }));

describe('useInsuranceUnstakeStatus fallback', () => {
    let getLogs: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1 });
        getLogs = vi.fn();
        (usePublicClient as any).mockReturnValue({ getLogs });
    });

    function setReads({ readErr = false, readOk = false, requestAt, cooldown = 3600n }: any) {
        (useReadContract as any).mockImplementation(({ functionName }: any) => {
            if (functionName === 'unstakeRequestTime') {
                return { data: requestAt, isSuccess: readOk, isFetched: true, isError: readErr, refetch: vi.fn() };
            }
            if (functionName === 'unstakeCooldown') {
                return { data: cooldown, isFetched: true, refetch: vi.fn() };
            }
            return { isFetched: true, refetch: vi.fn() };
        });
    }

    it('uses the logs fallback when the contract read errors', async () => {
        setReads({ readErr: true, readOk: false });
        const now = Math.floor(Date.now() / 1000);
        // Fallback query returns a recent request time -> cooldown phase.
        (useQuery as any).mockReturnValue({ data: { requestAtBn: BigInt(now - 100) }, isFetched: true, isError: false, isPending: false, refetch: vi.fn() });
        const { result } = renderHook(() => useInsuranceUnstakeStatus());
        expect(result.current.phase).toBe('cooldown');
    });

    it('reports a status error when both the read and fallback fail', () => {
        setReads({ readErr: true, readOk: false });
        (useQuery as any).mockReturnValue({ data: undefined, isFetched: true, isError: true, isPending: false, refetch: vi.fn() });
        const { result } = renderHook(() => useInsuranceUnstakeStatus());
        expect(result.current.statusError).toBe(true);
        expect(result.current.phase).toBe('error');
    });

    it('fallback queryFn parses the latest UnstakeRequested log', async () => {
        setReads({ readErr: true, readOk: false });
        (useQuery as any).mockReturnValue({ data: { requestAtBn: 0n }, isFetched: true, isError: false, isPending: false, refetch: vi.fn() });
        renderHook(() => useInsuranceUnstakeStatus());
        const queryFn = (useQuery as any).mock.calls[0][0].queryFn;
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') {
                return Promise.resolve([{ args: { timestamp: 1234n }, blockNumber: 10n, logIndex: 1 }]);
            }
            return Promise.resolve([]);
        });
        const res = await queryFn();
        expect(res.requestAtBn).toBe(1234n);
    });

    it('fallback queryFn returns 0 when an unstake happened after the request', async () => {
        setReads({ readErr: true, readOk: false });
        (useQuery as any).mockReturnValue({ data: { requestAtBn: 0n }, isFetched: true, isError: false, isPending: false, refetch: vi.fn() });
        renderHook(() => useInsuranceUnstakeStatus());
        const queryFn = (useQuery as any).mock.calls[0][0].queryFn;
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') return Promise.resolve([{ args: { timestamp: 1n }, blockNumber: 10n, logIndex: 0 }]);
            return Promise.resolve([{ blockNumber: 20n, logIndex: 0 }]); // later unstake
        });
        const res = await queryFn();
        expect(res.requestAtBn).toBe(0n);
    });

    it('refetch triggers all underlying refetches', () => {
        setReads({ readOk: true, requestAt: 0n });
        const fbRefetch = vi.fn();
        (useQuery as any).mockReturnValue({ data: { requestAtBn: 0n }, isFetched: true, isError: false, isPending: false, refetch: fbRefetch });
        const { result } = renderHook(() => useInsuranceUnstakeStatus());
        act(() => { result.current.refetch(); });
        expect(fbRefetch).toHaveBeenCalled();
    });

    function captureQueryFn() {
        setReads({ readErr: true, readOk: false });
        (useQuery as any).mockReturnValue({ data: { requestAtBn: 0n }, isFetched: true, isError: false, isPending: false, refetch: vi.fn() });
        renderHook(() => useInsuranceUnstakeStatus());
        return (useQuery as any).mock.calls[0][0].queryFn;
    }

    it('picks the latest of several requests across higher and lower blocks', async () => {
        const queryFn = captureQueryFn();
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') {
                return Promise.resolve([
                    { args: { timestamp: 100n }, blockNumber: 5n, logIndex: 0 },
                    { args: { timestamp: 300n }, blockNumber: 30n, logIndex: 2 }, // highest block -> winner
                    { args: { timestamp: 200n }, blockNumber: 12n, logIndex: 5 },
                ]);
            }
            return Promise.resolve([]);
        });
        const res = await queryFn();
        expect(res.requestAtBn).toBe(300n);
    });

    it('breaks block ties by logIndex', async () => {
        const queryFn = captureQueryFn();
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') {
                return Promise.resolve([
                    { args: { timestamp: 100n }, blockNumber: 7n, logIndex: 1 },
                    { args: { timestamp: 999n }, blockNumber: 7n, logIndex: 9 }, // same block, higher logIndex -> winner
                    { args: { timestamp: 50n }, blockNumber: 7n, logIndex: 4 },
                ]);
            }
            return Promise.resolve([]);
        });
        const res = await queryFn();
        expect(res.requestAtBn).toBe(999n);
    });

    it('treats missing blockNumber/logIndex/timestamp as zero', async () => {
        const queryFn = captureQueryFn();
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') {
                return Promise.resolve([{ args: {} }]); // no blockNumber/logIndex/timestamp
            }
            return Promise.resolve([]);
        });
        const res = await queryFn();
        expect(res.requestAtBn).toBe(0n);
    });

    it('returns 0 when there are no request logs at all', async () => {
        const queryFn = captureQueryFn();
        getLogs.mockResolvedValue([]);
        const res = await queryFn();
        expect(res.requestAtBn).toBe(0n);
    });

    it('keeps the request when an earlier unstake precedes it', async () => {
        const queryFn = captureQueryFn();
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') return Promise.resolve([{ args: { timestamp: 555n }, blockNumber: 40n, logIndex: 0 }]);
            return Promise.resolve([{ blockNumber: 10n, logIndex: 0 }]); // earlier unstake -> request still valid
        });
        const res = await queryFn();
        expect(res.requestAtBn).toBe(555n);
    });

    it('returns 0 from queryFn when publicClient is missing', async () => {
        (usePublicClient as any).mockReturnValue(null);
        setReads({ readErr: true, readOk: false });
        (useQuery as any).mockReturnValue({ data: { requestAtBn: 0n }, isFetched: true, isError: false, isPending: false, refetch: vi.fn() });
        renderHook(() => useInsuranceUnstakeStatus());
        const queryFn = (useQuery as any).mock.calls[0][0].queryFn;
        const res = await queryFn();
        expect(res.requestAtBn).toBe(0n);
    });

    it('compares logs that are missing blockNumber/logIndex (?? 0 fallbacks)', async () => {
        const queryFn = captureQueryFn();
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') {
                return Promise.resolve([
                    { args: { timestamp: 11n } }, // no blockNumber / logIndex -> ?? 0
                    { args: { timestamp: 22n }, blockNumber: 0n, logIndex: 0 }, // explicit zeros, equal order -> reducer keeps best
                ]);
            }
            return Promise.resolve([]);
        });
        const res = await queryFn();
        // both compare equal (0/0) so reduce keeps the first (timestamp 11n)
        expect(res.requestAtBn).toBe(11n);
    });

    it('compares when the reduced "cur" log is the one missing fields', async () => {
        const queryFn = captureQueryFn();
        getLogs.mockImplementation(({ event }: any) => {
            if (event?.name === 'UnstakeRequested') {
                return Promise.resolve([
                    { args: { timestamp: 33n }, blockNumber: 2n, logIndex: 1 }, // best (arr[0]) has fields
                    { args: { timestamp: 44n } }, // cur (arr[1]) missing block/logIndex -> a.?? 0 fires
                ]);
            }
            return Promise.resolve([]);
        });
        const res = await queryFn();
        // cur (0/0) < best (2/1) so best (timestamp 33n) is kept
        expect(res.requestAtBn).toBe(33n);
    });
});
