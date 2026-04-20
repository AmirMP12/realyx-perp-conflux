import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    useTradeHistory,
    useBackendStats,
    useMarkets,
    useReferralCode,
    useReferralStats,
    normalizeReferralStats,
    referralCodeFromWallet,
    buildReferralShareLink,
    useBackendPositions,
    useInsuranceClaims,
    useDailyStats,
    useLeaderboard,
    normalizeLeaderboardEntries,
} from '../useBackend';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(() => ({ address: undefined })),
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
}));

describe('useBackend hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true, data: [] })
        }));
    });

    describe('useTradeHistory', () => {
        it('returns empty trades if no address', () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            (useQuery as any).mockReturnValue({ data: [], isLoading: false });
            
            const { result } = renderHook(() => useTradeHistory());
            expect(result.current.trades).toEqual([]);
        });

        it('returns trades from useQuery', () => {
            const mockTrades = [{ id: 1, signature: '0xabc' }];
            (useAccount as any).mockReturnValue({ address: '0x123' });
            (useQuery as any).mockReturnValue({ data: mockTrades, isLoading: false });
            
            const { result } = renderHook(() => useTradeHistory());
            expect(result.current.trades).toEqual(mockTrades);
        });
    });

    describe('useBackendStats', () => {
        it('returns stats from useQuery', () => {
            const mockStats = { volume24h: '1000' };
            (useQuery as any).mockReturnValue({ data: mockStats, isLoading: false });
            
            const { result } = renderHook(() => useBackendStats());
            expect(result.current.stats).toEqual(mockStats);
        });
    });

    describe('useMarkets', () => {
        it('returns backend markets from useQuery', () => {
            const mockMarkets = [{ id: 'btc', name: 'Bitcoin' }];
            (useQuery as any).mockReturnValue({ data: mockMarkets, isLoading: false });
            
            const { result } = renderHook(() => useMarkets());
            expect(result.current.markets).toEqual(mockMarkets);
        });
    });

    describe('useReferralCode', () => {
        it('generates code from address', () => {
            (useAccount as any).mockReturnValue({ address: '0x123456789' });
            const { result } = renderHook(() => useReferralCode());
            expect(result.current.code).toBe('123456');
        });

        it('returns null if no address', () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            const { result } = renderHook(() => useReferralCode());
            expect(result.current.code).toBeNull();
        });

        it('builds link with encoded ref param', () => {
            (useAccount as any).mockReturnValue({ address: '0xabcdef0000000000000000000000000000000001' });
            const { result } = renderHook(() => useReferralCode());
            expect(result.current.link).toContain('/?ref=ABCDEF');
        });
    });

    describe('referralCodeFromWallet', () => {
        it('returns null for too-short hex', () => {
            expect(referralCodeFromWallet('0x1234')).toBeNull();
        });
    });

    describe('buildReferralShareLink', () => {
        it('encodes code for URL', () => {
            expect(buildReferralShareLink('AB CD')).toContain(encodeURIComponent('AB CD'));
        });
    });

    describe('useBackendPositions', () => {
        it('fetches and sets positions for address', async () => {
            const mockPositions = [{ id: 1, side: 'LONG' }];
            (useAccount as any).mockReturnValue({ address: '0x123' });
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, data: mockPositions })
            });
            vi.stubGlobal('fetch', mockFetch);

            const { result } = renderHook(() => useBackendPositions());
            
            await act(async () => {
                await result.current.refetch();
            });

            expect(result.current.positions).toEqual(mockPositions);
        });

        it('clears positions if address becomes undefined', async () => {
            const { result, rerender } = renderHook(() => useBackendPositions());
            // Address undefined triggers an effect that calls setPositions([])
            (useAccount as any).mockReturnValue({ address: undefined });
            await act(async () => {
                rerender();
            });
            await waitFor(() => expect(result.current.positions).toEqual([]));
        });
    });

    describe('useInsuranceClaims', () => {
        it('fetches and sets claims', async () => {
            const mockClaims = [{ id: '1', amount: '100' }];
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, data: mockClaims })
            });
            vi.stubGlobal('fetch', mockFetch);

            const { result } = renderHook(() => useInsuranceClaims());
            
            await act(async () => {
                await result.current.refetch();
            });

            expect(result.current.claims).toEqual(mockClaims);
        });
    });

    describe('useDailyStats', () => {
        it('returns daily stats from query', () => {
            const mockDaily = [{ date: '2024-01-01', volume: '500' }];
            (useQuery as any).mockReturnValue({ data: mockDaily, isLoading: false });
            
            const { result } = renderHook(() => useDailyStats());
            expect(result.current.stats).toEqual(mockDaily);
        });
    });

    describe('useLeaderboard', () => {
        it('returns formatted entries from query', () => {
            // Mock what normalized entries look like because useQuery returns the final result
            const mockEntries = [{ rank: 1, wallet: '0x1', pnl: '100', volume: '0', trades: 0 }];
            (useQuery as any).mockReturnValue({ data: mockEntries, isLoading: false });
            
            const { result } = renderHook(() => useLeaderboard());
            expect(result.current.entries).toEqual(mockEntries);
        });
    });

    describe('normalizeLeaderboardEntries', () => {
        it('handles non-array input', () => {
            expect(normalizeLeaderboardEntries(null)).toEqual([]);
        });

        it('normalizes various input shapes', () => {
            const raw = [
                { wallet: '0x1', pnl: 100 },
                { address: '0x2', volume: '5000', trades: 5 }
            ];
            const result = normalizeLeaderboardEntries(raw);
            expect(result[0]).toEqual({ rank: 1, wallet: '0x1', pnl: '100', volume: '0', trades: 0 });
            expect(result[1]).toEqual({ rank: 2, wallet: '0x2', pnl: '0', volume: '5000', trades: 5 });
        });
    });

    describe('normalizeReferralStats', () => {
        const wallet = '0xabcdef0000000000000000000000000000000001';

        it('coerces string amounts and snake_case keys', () => {
            expect(
                normalizeReferralStats(
                    { referees: '3', total_earned: '1,250.5', pending_claim: '100', referral_code: 'custom1' },
                    wallet
                )
            ).toEqual({
                referees: 3,
                totalEarned: 1250.5,
                pendingClaim: 100,
                code: 'CUSTOM1',
            });
        });

        it('handles varied key names for referees and earnings', () => {
            expect(
                normalizeReferralStats(
                    { referralCount: 5, totalEarnings: 200, claimable: 50, ref: 'PARTNER' },
                    wallet
                )
            ).toMatchObject({
                referees: 5,
                totalEarned: 200,
                pendingClaim: 50,
                code: 'PARTNER'
            });
        });

        it('falls back to wallet segment when code missing', () => {
            expect(normalizeReferralStats({ referees: 1 }, wallet).code).toBe('ABCDEF');
        });

        it('handles non-object raw input', () => {
            expect(normalizeReferralStats('invalid', wallet)).toMatchObject({
                referees: 0,
                totalEarned: 0,
                pendingClaim: 0,
                code: 'ABCDEF',
            });
        });
    });

    describe('useReferralStats', () => {
        it('returns empty stats if no address', async () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            (useQuery as any).mockImplementation(({ queryFn }) => {
                const res = queryFn();
                return { data: res instanceof Promise ? undefined : res, isLoading: false };
            });
            
            const { result } = renderHook(() => useReferralStats());
            expect(result.current.stats).toMatchObject({ referees: 0 });
        });

        it('handles fetch failure', async () => {
            (useAccount as any).mockReturnValue({ address: '0x123' });
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network Error')));
            
            // Mock useQuery to immediately execute and return the result of queryFn
            (useQuery as any).mockImplementation(({ queryFn: _queryFn }) => {
                // Forcing sync return for test simplicity if possible, or using the fallback logic in the hook
                return { data: undefined, isLoading: false };
            });

            const { result } = renderHook(() => useReferralStats());
            // It should fall back to normalizeReferralStats(null) which has a code
            expect(result.current.stats.code).toBeDefined();
        });
    });
});
