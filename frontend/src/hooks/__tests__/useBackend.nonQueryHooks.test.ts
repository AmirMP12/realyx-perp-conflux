import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    useBackendPositions,
    useInsuranceClaims,
    normalizeLeaderboardEntries,
    normalizeReferralStats,
    referralCodeFromWallet,
    buildReferralShareLink,
} from '../useBackend';
import { useAccount } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));

function mockFetch(impl: any) {
    vi.stubGlobal('fetch', vi.fn(impl));
}

describe('useBackend non-query hooks + helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xabc0000000000000000000000000000000000001' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('useBackendPositions', () => {
        it('does nothing without an address', async () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: [] }) }));
            const { result } = renderHook(() => useBackendPositions());
            await waitFor(() => expect(result.current.positions).toEqual([]));
            expect(fetch).not.toHaveBeenCalled();
        });

        it('loads positions on success', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: [{ id: 1 }] }) }));
            const { result } = renderHook(() => useBackendPositions());
            await waitFor(() => expect(result.current.positions).toEqual([{ id: 1 }]));
        });

        it('ignores payload when success is false', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: false, data: [{ id: 9 }] }) }));
            const { result } = renderHook(() => useBackendPositions());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.positions).toEqual([]);
        });

        it('handles a non-ok response (throws then caught)', async () => {
            mockFetch(async () => ({ ok: false, json: async () => ({}) }));
            const { result } = renderHook(() => useBackendPositions());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.positions).toEqual([]);
            expect(console.error).toHaveBeenCalled();
        });

        it('refetch invokes fetch again', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: [{ id: 2 }] }) }));
            const { result } = renderHook(() => useBackendPositions());
            await waitFor(() => expect(result.current.positions).toEqual([{ id: 2 }]));
            await act(async () => { await result.current.refetch(); });
            expect((fetch as any).mock.calls.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('useInsuranceClaims', () => {
        it('loads claims array on success', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: [{ id: 'c1' }] }) }));
            const { result } = renderHook(() => useInsuranceClaims(5));
            await waitFor(() => expect(result.current.claims).toEqual([{ id: 'c1' }]));
        });

        it('sets [] when data not an array', async () => {
            mockFetch(async () => ({ ok: true, json: async () => ({ success: true, data: null }) }));
            const { result } = renderHook(() => useInsuranceClaims());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.claims).toEqual([]);
        });

        it('sets [] and logs on fetch failure', async () => {
            mockFetch(async () => { throw new Error('net'); });
            const { result } = renderHook(() => useInsuranceClaims());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.claims).toEqual([]);
            expect(console.error).toHaveBeenCalled();
        });

        it('handles a json parse error gracefully', async () => {
            mockFetch(async () => ({ ok: true, json: async () => { throw new Error('json'); } }));
            const { result } = renderHook(() => useInsuranceClaims());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.claims).toEqual([]);
        });
    });

    describe('normalizeLeaderboardEntries', () => {
        it('returns [] for non-array', () => {
            expect(normalizeLeaderboardEntries(null)).toEqual([]);
            expect(normalizeLeaderboardEntries({})).toEqual([]);
        });

        it('uses index+1 when rank missing and address/tradeCount fallbacks', () => {
            const res = normalizeLeaderboardEntries([{ address: '0xAA', tradeCount: 3 }, 'notobject']);
            expect(res[0].rank).toBe(1);
            expect(res[0].wallet).toBe('0xAA');
            expect(res[0].trades).toBe(3);
            expect(res[1].rank).toBe(2);
            expect(res[1].wallet).toBe('');
        });

        it('reads explicit rank/pnl/volume', () => {
            const res = normalizeLeaderboardEntries([{ rank: 5, wallet: '0x1', pnl: 10, volume: 20, trades: 2 }]);
            expect(res[0]).toEqual({ rank: 5, wallet: '0x1', pnl: '10', volume: '20', trades: 2 });
        });
    });

    describe('normalizeReferralStats', () => {
        const wallet = '0xabcdef0000000000000000000000000000000001';

        it('returns fallback for non-object raw', () => {
            const res = normalizeReferralStats(null, wallet);
            expect(res).toMatchObject({ referees: 0, totalEarned: 0, code: 'ABCDEF', live: false });
        });

        it('parses comma-formatted numbers and alternate keys', () => {
            const res = normalizeReferralStats({ referral_count: '3', total_earned: '1,234.5', pending_claim: '12', referral_code: 'zz', live: true }, wallet);
            expect(res.referees).toBe(3);
            expect(res.totalEarned).toBeCloseTo(1234.5);
            expect(res.pendingClaim).toBe(12);
            expect(res.code).toBe('ZZ');
            expect(res.live).toBe(true);
        });

        it('skips null/undefined keys and non-finite values', () => {
            const res = normalizeReferralStats({ referees: null, totalEarned: 'NaNxyz', code: '   ' }, wallet);
            expect(res.referees).toBe(0);
            expect(res.totalEarned).toBe(0);
            expect(res.code).toBe('ABCDEF');
        });

        it('clamps negatives to zero', () => {
            const res = normalizeReferralStats({ referees: -5, totalEarned: -1 }, wallet);
            expect(res.referees).toBe(0);
            expect(res.totalEarned).toBe(0);
        });
    });

    describe('referral helpers', () => {
        it('referralCodeFromWallet handles short/invalid', () => {
            expect(referralCodeFromWallet(null)).toBeNull();
            expect(referralCodeFromWallet('0x12')).toBeNull();
            expect(referralCodeFromWallet('nothex0000000')).toBeNull();
            expect(referralCodeFromWallet('0xabcdef1234')).toBe('ABCDEF');
        });

        it('buildReferralShareLink encodes the code', () => {
            expect(buildReferralShareLink('A B')).toContain('ref=A%20B');
        });
    });
});
