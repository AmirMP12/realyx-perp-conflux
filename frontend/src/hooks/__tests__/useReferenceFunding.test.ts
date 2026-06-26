import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useReferenceFunding } from '../useReferenceFunding';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));

describe('useReferenceFunding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    function getQueryFn() {
        return (useQuery as any).mock.calls[0][0].queryFn;
    }

    it('reports hasReference based on binance symbol availability', () => {
        (useQuery as any).mockReturnValue({ data: 0.0001, isLoading: false });
        const { result } = renderHook(() => useReferenceFunding('BTC'));
        expect(result.current.referenceRate8h).toBe(0.0001);
        expect(result.current.hasReference).toBe(true);
        expect(result.current.loading).toBe(false);
    });

    it('reports no reference for unknown / non-CEX markets', () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false });
        const { result } = renderHook(() => useReferenceFunding(undefined));
        expect(result.current.referenceRate8h).toBeNull();
        expect(result.current.hasReference).toBe(false);
    });

    it('queryFn returns parsed funding rate', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false });
        renderHook(() => useReferenceFunding('BTC'));
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ lastFundingRate: '0.0005' }) });
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toBeCloseTo(0.0005);
    });

    it('queryFn returns null on non-ok response', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false });
        renderHook(() => useReferenceFunding('ETH'));
        (global.fetch as any).mockResolvedValue({ ok: false });
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toBeNull();
    });

    it('queryFn returns null when rate is not finite', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false });
        renderHook(() => useReferenceFunding('ETH'));
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ lastFundingRate: 'abc' }) });
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toBeNull();
    });

    it('queryFn returns null when fetch throws', async () => {
        (useQuery as any).mockReturnValue({ data: undefined, isLoading: false });
        renderHook(() => useReferenceFunding('ETH'));
        (global.fetch as any).mockRejectedValue(new Error('network'));
        const queryFn = getQueryFn();
        await expect(queryFn()).resolves.toBeNull();
    });
});
