import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useVaultYield } from '../useVaultYield';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));

describe('useVaultYield', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    function getQueryFn() {
        renderHook(() => useVaultYield());
        return (useQuery as any).mock.calls[0][0].queryFn;
    }

    it('returns the fetched yield and surfaces no error', () => {
        const data = { tvl: 10, windowDays: 30, totalApr: 5, sources: [], history: [], estimated: false };
        (useQuery as any).mockReturnValue({ data, isLoading: false, error: null, refetch: vi.fn() });
        const { result } = renderHook(() => useVaultYield());
        expect(result.current.yield).toEqual(data);
        expect(result.current.error).toBeNull();
    });

    it('falls back to EMPTY when data is undefined and reports error', () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: new Error('x'), refetch: vi.fn() });
        const { result } = renderHook(() => useVaultYield());
        expect(result.current.yield.tvl).toBe(0);
        expect(result.current.yield.estimated).toBe(true);
        expect(result.current.error).toBe('x');
    });

    it('queryFn returns data on success', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
        (global.fetch as any).mockResolvedValue({ json: async () => ({ success: true, data: { tvl: 99 } }) });
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toEqual({ tvl: 99 });
    });

    it('queryFn returns EMPTY on failure', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
        (global.fetch as any).mockResolvedValue({ json: async () => ({ success: false }) });
        const queryFn = getQueryFn();
        const res = await queryFn();
        expect(res.tvl).toBe(0);
        expect(res.estimated).toBe(true);
    });

    it('queryFn returns EMPTY when json throws', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
        (global.fetch as any).mockResolvedValue({ json: async () => { throw new Error('nope'); } });
        const queryFn = getQueryFn();
        const res = await queryFn();
        expect(res.tvl).toBe(0);
    });
});
