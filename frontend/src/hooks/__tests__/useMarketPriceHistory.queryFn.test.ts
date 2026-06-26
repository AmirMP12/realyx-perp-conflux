import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMarketPriceHistory } from '../useMarketPriceHistory';
import { useQuery } from '@tanstack/react-query';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));

function captureQueryFn() {
    (useQuery as any).mockReturnValue({ data: undefined, isLoading: false, error: null });
    renderHook(() => useMarketPriceHistory('0xMarket', 7));
    return (useQuery as any).mock.calls.at(-1)[0].queryFn;
}

describe('useMarketPriceHistory queryFn', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns [] when no market address', async () => {
        (useQuery as any).mockReturnValue({ data: [], isLoading: false, error: null });
        renderHook(() => useMarketPriceHistory(undefined));
        const qf = (useQuery as any).mock.calls.at(-1)[0].queryFn;
        await expect(qf()).resolves.toEqual([]);
    });

    it('returns price points on success', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: [{ timestamp: 1, value: 2 }] }) })));
        const qf = captureQueryFn();
        await expect(qf()).resolves.toEqual([{ timestamp: 1, value: 2 }]);
    });

    it('returns [] when the response is unsuccessful', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false }) })));
        const qf = captureQueryFn();
        await expect(qf()).resolves.toEqual([]);
    });

    it('returns [] when data is not an array', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: 'nope' }) })));
        const qf = captureQueryFn();
        await expect(qf()).resolves.toEqual([]);
    });

    it('returns [] when json parsing throws', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => { throw new Error('bad'); } })));
        const qf = captureQueryFn();
        await expect(qf()).resolves.toEqual([]);
    });

    it('exposes loading and error from the query', () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: true, error: new Error('x') });
        const { result } = renderHook(() => useMarketPriceHistory('0xM'));
        expect(result.current.loading).toBe(true);
        expect(result.current.prices).toEqual([]);
    });
});
