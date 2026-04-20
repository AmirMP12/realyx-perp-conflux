
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInsuranceUnstakeStatus, messageForUnstakeRevert } from '../useVault';
import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    useReadContract: vi.fn(),
    usePublicClient: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
}));

describe('useVault Unstake Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('messageForUnstakeRevert', () => {
        it('maps known selectors to user-friendly messages', () => {
            expect(messageForUnstakeRevert({ data: '0x30c6feeb' })).toContain('Start the unstake timer first');
            expect(messageForUnstakeRevert({ data: '0x88dd9788' })).toContain('waiting period is not over');
            expect(messageForUnstakeRevert({ data: '0x39996567' })).toContain('Not enough insurance shares');
            expect(messageForUnstakeRevert({ data: '0xfe7cb88a' })).toContain('minimum health ratio');
            expect(messageForUnstakeRevert({ data: '0x32d971dc' })).toContain('Invalid amount');
        });

        it('returns undefined for unknown selector', () => {
            expect(messageForUnstakeRevert({ data: '0xdeadbeef' })).toBeUndefined();
        });
    });

    describe('useInsuranceUnstakeStatus', () => {
        const address = '0x123';
        const cooldownBn = 86400n; // 1 day

        beforeEach(() => {
            (useAccount as any).mockReturnValue({ address });
            (usePublicClient as any).mockReturnValue({});
            (useQuery as any).mockReturnValue({ isFetched: true, data: { requestAtBn: 0n } });
        });

        it('returns need_request when requestTime is 0', () => {
            (useReadContract as any).mockImplementation(({ functionName }) => {
                if (functionName === 'unstakeRequestTime') return { data: 0n, isSuccess: true, isFetched: true, refetch: vi.fn() };
                if (functionName === 'unstakeCooldown') return { data: cooldownBn, isFetched: true, refetch: vi.fn() };
                return { isFetched: true };
            });

            const { result } = renderHook(() => useInsuranceUnstakeStatus());
            expect(result.current.phase).toBe('need_request');
        });

        it('returns cooldown when waiting period not met', () => {
            const now = Math.floor(Date.now() / 1000);
            (useReadContract as any).mockImplementation(({ functionName }) => {
                if (functionName === 'unstakeRequestTime') return { data: BigInt(now - 100), isSuccess: true, isFetched: true, refetch: vi.fn() };
                if (functionName === 'unstakeCooldown') return { data: cooldownBn, isFetched: true, refetch: vi.fn() };
                return { isFetched: true };
            });

            const { result } = renderHook(() => useInsuranceUnstakeStatus());
            expect(result.current.phase).toBe('cooldown');
        });

        it('returns ready when waiting period is over', () => {
            const now = Math.floor(Date.now() / 1000);
            (useReadContract as any).mockImplementation(({ functionName }) => {
                const reqTime = BigInt(now - Number(cooldownBn) - 10);
                if (functionName === 'unstakeRequestTime') return { data: reqTime, isSuccess: true, isFetched: true, refetch: vi.fn() };
                if (functionName === 'unstakeCooldown') return { data: cooldownBn, isFetched: true, refetch: vi.fn() };
                return { isFetched: true };
            });

            const { result } = renderHook(() => useInsuranceUnstakeStatus());
            expect(result.current.phase).toBe('ready');
        });
    });
});
