import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
    useTradeHistory,
    useBackendStats,
    useDailyStats,
    useLeaderboard,
    useMarkets,
    useReferralStats,
} from '../useBackend';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));

function captureQueryFn(renderFn: () => void) {
    (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
    renderFn();
    const calls = (useQuery as any).mock.calls;
    return calls[calls.length - 1][0].queryFn;
}

function mockFetch(impl: any) {
    vi.stubGlobal('fetch', vi.fn(impl));
}

describe('useBackend queryFns', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xabc' });
    });

    describe('useTradeHistory.queryFn', () => {
        it('returns [] without address', async () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            const qf = captureQueryFn(() => renderHook(() => useTradeHistory()));
            await expect(qf()).resolves.toEqual([]);
        });

        it('returns data on success', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: [{ id: 1 }] }) }));
            const qf = captureQueryFn(() => renderHook(() => useTradeHistory(5)));
            await expect(qf()).resolves.toEqual([{ id: 1 }]);
        });

        it('throws when response not ok', async () => {
            mockFetch(async () => ({ ok: false, json: async () => ({}) }));
            const qf = captureQueryFn(() => renderHook(() => useTradeHistory()));
            await expect(qf()).rejects.toThrow('Failed to fetch trades');
        });

        it('throws on success:false', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: false, error: 'nope' }) }));
            const qf = captureQueryFn(() => renderHook(() => useTradeHistory()));
            await expect(qf()).rejects.toThrow('nope');
        });

        it('throws default message on success:false without error', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: false }) }));
            const qf = captureQueryFn(() => renderHook(() => useTradeHistory()));
            await expect(qf()).rejects.toThrow('Unknown error');
        });
    });

    describe('error-state surfaces from useQuery', () => {
        function withError(renderFn: () => void) {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
            renderFn();
        }

        it('useTradeHistory maps query error to message', () => {
            let hook: any;
            withError(() => { hook = renderHook(() => useTradeHistory()); });
            expect(hook.result.current.error).toBe('boom');
        });

        it('useBackendStats maps query error to message', () => {
            let hook: any;
            withError(() => { hook = renderHook(() => useBackendStats()); });
            expect(hook.result.current.error).toBe('boom');
        });

        it('useDailyStats maps query error to message', () => {
            let hook: any;
            withError(() => { hook = renderHook(() => useDailyStats()); });
            expect(hook.result.current.error).toBe('boom');
        });

        it('useLeaderboard maps query error to message', () => {
            let hook: any;
            withError(() => { hook = renderHook(() => useLeaderboard()); });
            expect(hook.result.current.error).toBe('boom');
        });

        it('useMarkets maps query error to message', () => {
            let hook: any;
            withError(() => { hook = renderHook(() => useMarkets()); });
            expect(hook.result.current.error).toBe('boom');
        });

        it('useReferralStats maps query error to message', () => {
            (useAccount as any).mockReturnValue({ address: '0xabcdef0000000000000000000000000000000001' });
            let hook: any;
            withError(() => { hook = renderHook(() => useReferralStats()); });
            expect(hook.result.current.error).toBe('boom');
        });
    });

    describe('useBackendStats.queryFn', () => {
        it('returns data.data on success', async () => {
            mockFetch(async () => ({ json: async () => ({ success: true, data: { volume24h: '1' } }) }));
            const qf = captureQueryFn(() => renderHook(() => useBackendStats()));
            await expect(qf()).resolves.toEqual({ volume24h: '1' });
        });

        it('returns data.data even when success missing', async () => {
            mockFetch(async () => ({ json: async () => ({ data: { volume24h: '2' } }) }));
            const qf = captureQueryFn(() => renderHook(() => useBackendStats()));
            await expect(qf()).resolves.toEqual({ volume24h: '2' });
        });

        it('throws when neither success nor data', async () => {
            mockFetch(async () => ({ json: async () => ({ error: 'bad' }) }));
            const qf = captureQueryFn(() => renderHook(() => useBackendStats()));
            await expect(qf()).rejects.toThrow('bad');
        });

        it('throws when json parse fails', async () => {
            mockFetch(async () => ({ json: async () => { throw new Error('x'); } }));
            const qf = captureQueryFn(() => renderHook(() => useBackendStats()));
            await expect(qf()).rejects.toThrow();
        });
    });

    describe('useDailyStats.queryFn', () => {
        it('returns array on success', async () => {
            mockFetch(async () => ({ json: async () => ({ success: true, data: [{ date: 'd' }] }) }));
            const qf = captureQueryFn(() => renderHook(() => useDailyStats()));
            await expect(qf()).resolves.toEqual([{ date: 'd' }]);
        });

        it('returns [] when data not array', async () => {
            mockFetch(async () => ({ json: async () => ({ success: true, data: null }) }));
            const qf = captureQueryFn(() => renderHook(() => useDailyStats()));
            await expect(qf()).resolves.toEqual([]);
        });

        it('throws when not successful', async () => {
            mockFetch(async () => ({ json: async () => ({ success: false }) }));
            const qf = captureQueryFn(() => renderHook(() => useDailyStats()));
            await expect(qf()).rejects.toThrow();
        });
    });

    describe('useLeaderboard.queryFn', () => {
        it('normalizes data on success', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: [{ wallet: '0x1', pnl: 1 }] }) }));
            const qf = captureQueryFn(() => renderHook(() => useLeaderboard(10, '24h')));
            const res = await qf();
            expect(res[0].wallet).toBe('0x1');
        });

        it('throws network error when fetch rejects', async () => {
            mockFetch(async () => { throw new Error('boom'); });
            const qf = captureQueryFn(() => renderHook(() => useLeaderboard(10, '7d')));
            await expect(qf()).rejects.toThrow('Network error loading leaderboard');
        });

        it('throws when not ok', async () => {
            mockFetch(async () => ({ ok: false, json: async () => ({ error: 'fail' }) }));
            const qf = captureQueryFn(() => renderHook(() => useLeaderboard()));
            await expect(qf()).rejects.toThrow('fail');
        });

        it('throws when success:false', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: false, error: 'off' }) }));
            const qf = captureQueryFn(() => renderHook(() => useLeaderboard()));
            await expect(qf()).rejects.toThrow('off');
        });
    });

    describe('useMarkets.queryFn', () => {
        it('returns placeholder markets when data empty', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: [] }) }));
            const qf = captureQueryFn(() => renderHook(() => useMarkets()));
            const res = await qf();
            expect(Array.isArray(res)).toBe(true);
            expect(res.length).toBeGreaterThan(0);
        });

        it('sorts CFX-USD first', async () => {
            mockFetch(async () => ({
                ok: true,
                json: async () => ({ success: true, data: [{ symbol: 'ETH-USD' }, { symbol: 'CFX-USD' }] }),
            }));
            const qf = captureQueryFn(() => renderHook(() => useMarkets()));
            const res = await qf();
            expect(res[0].symbol).toBe('CFX-USD');
        });

        it('throws when not ok', async () => {
            mockFetch(async () => ({ ok: false, json: async () => ({ error: 'mkt fail' }) }));
            const qf = captureQueryFn(() => renderHook(() => useMarkets()));
            await expect(qf()).rejects.toThrow('mkt fail');
        });
    });

    describe('useReferralStats.queryFn', () => {
        const wallet = '0xabcdef0000000000000000000000000000000001';

        beforeEach(() => {
            (useAccount as any).mockReturnValue({ address: wallet });
        });

        it('returns EMPTY when no address', async () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            const qf = captureQueryFn(() => renderHook(() => useReferralStats()));
            await expect(qf()).resolves.toMatchObject({ code: '', live: false });
        });

        it('normalizes data payload from body.data', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: { referees: 2, live: true, code: 'X1' } }) }));
            const qf = captureQueryFn(() => renderHook(() => useReferralStats()));
            const res = await qf();
            expect(res.referees).toBe(2);
            expect(res.live).toBe(true);
        });

        it('uses body itself when referral-like keys present', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ referees: 4, code: 'BODY' }) }));
            const qf = captureQueryFn(() => renderHook(() => useReferralStats()));
            const res = await qf();
            expect(res.referees).toBe(4);
            expect(res.code).toBe('BODY');
        });

        it('falls back to normalize(null) on fetch error', async () => {
            mockFetch(async () => { throw new Error('net'); });
            const qf = captureQueryFn(() => renderHook(() => useReferralStats()));
            const res = await qf();
            expect(res.code).toBe('ABCDEF');
            expect(res.live).toBe(false);
        });

        it('falls back to normalize(null) on json error', async () => {
            mockFetch(async () => ({ ok: true, json: async () => { throw new Error('json'); } }));
            const qf = captureQueryFn(() => renderHook(() => useReferralStats()));
            const res = await qf();
            expect(res.code).toBe('ABCDEF');
        });

        it('falls back to normalize(null) when not ok', async () => {
            mockFetch(async () => ({ ok: false, json: async () => ({ data: { referees: 9 } }) }));
            const qf = captureQueryFn(() => renderHook(() => useReferralStats()));
            const res = await qf();
            expect(res.referees).toBe(0);
        });

        it('returns null payload when success:false', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: false }) }));
            const qf = captureQueryFn(() => renderHook(() => useReferralStats()));
            const res = await qf();
            expect(res.referees).toBe(0);
        });
    });
});
