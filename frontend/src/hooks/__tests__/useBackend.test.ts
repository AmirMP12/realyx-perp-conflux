import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
    useTradeHistory,
    useBackendStats,
    useMarkets,
    useReferralCode,
    normalizeReferralStats,
    referralCodeFromWallet,
    buildReferralShareLink,
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
        vi.stubGlobal('fetch', vi.fn());
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

        it('falls back to wallet segment when code missing', () => {
            expect(normalizeReferralStats({ referees: 1 }, wallet).code).toBe('ABCDEF');
        });

        it('handles null raw', () => {
            expect(normalizeReferralStats(null, wallet)).toMatchObject({
                referees: 0,
                totalEarned: 0,
                pendingClaim: 0,
                code: 'ABCDEF',
            });
        });
    });
});
