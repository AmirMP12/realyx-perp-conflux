import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { useTopTraders, useFollowing, useCopierPnl } from '../useSocial';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('wagmi', () => ({ useAccount: vi.fn() }));

describe('useSocial hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
        (useAccount as any).mockReturnValue({ address: '0xabc' });
    });

    function lastQueryFn() {
        const calls = (useQuery as any).mock.calls;
        return calls[calls.length - 1][0].queryFn;
    }

    describe('useTopTraders', () => {
        it('returns traders list and no error', () => {
            (useQuery as any).mockReturnValue({ data: [{ address: '0x1' }], isLoading: false, error: null, refetch: vi.fn() });
            const { result } = renderHook(() => useTopTraders());
            expect(result.current.traders).toHaveLength(1);
            expect(result.current.error).toBeNull();
        });

        it('defaults to [] and surfaces error', () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: true, error: new Error('e'), refetch: vi.fn() });
            const { result } = renderHook(() => useTopTraders());
            expect(result.current.traders).toEqual([]);
            expect(result.current.error).toBe('e');
        });

        it('queryFn parses traders array', async () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useTopTraders());
            (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ traders: [{ address: '0x9' }] }) });
            const data = await lastQueryFn()();
            expect(data).toEqual([{ address: '0x9' }]);
        });

        it('queryFn returns [] when body has no traders', async () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useTopTraders());
            (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
            await expect(lastQueryFn()()).resolves.toEqual([]);
        });

        it('queryFn returns [] when feature unavailable (501)', async () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useTopTraders());
            (global.fetch as any).mockResolvedValue({ ok: false, status: 501, json: async () => ({}) });
            await expect(lastQueryFn()()).resolves.toEqual([]);
        });

        it('queryFn returns [] when fetch throws', async () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useTopTraders());
            (global.fetch as any).mockRejectedValue(new Error('net'));
            await expect(lastQueryFn()()).resolves.toEqual([]);
        });

        it('queryFn throws on other non-ok status', async () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useTopTraders());
            (global.fetch as any).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
            await expect(lastQueryFn()()).rejects.toThrow(/500/);
        });
    });

    describe('useFollowing', () => {
        it('returns following list', () => {
            (useQuery as any).mockReturnValue({ data: [{ address: '0x1' }], isLoading: false, error: null, refetch: vi.fn() });
            const { result } = renderHook(() => useFollowing());
            expect(result.current.following).toHaveLength(1);
        });

        it('queryFn returns [] when no address', async () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useFollowing());
            await expect(lastQueryFn()()).resolves.toEqual([]);
        });

        it('queryFn parses following array', async () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useFollowing());
            (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ following: [{ address: '0x2' }] }) });
            await expect(lastQueryFn()()).resolves.toEqual([{ address: '0x2' }]);
        });
    });

    describe('useCopierPnl', () => {
        it('returns pnl and defaults to null', () => {
            (useQuery as any).mockReturnValue({ data: null, isLoading: false, error: null, refetch: vi.fn() });
            const { result } = renderHook(() => useCopierPnl());
            expect(result.current.pnl).toBeNull();
        });

        it('queryFn returns null when no address', async () => {
            (useAccount as any).mockReturnValue({ address: undefined });
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useCopierPnl());
            await expect(lastQueryFn()()).resolves.toBeNull();
        });

        it('queryFn returns parsed pnl', async () => {
            (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
            renderHook(() => useCopierPnl());
            (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ totalCopiedPnl: '5' }) });
            await expect(lastQueryFn()()).resolves.toEqual({ totalCopiedPnl: '5' });
        });
    });
});
