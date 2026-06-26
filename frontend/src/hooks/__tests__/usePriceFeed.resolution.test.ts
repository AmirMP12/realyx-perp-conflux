import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePriceFeed } from '../usePriceFeed';
import { usePythDisplayPrice, getPythFeedId } from '../usePythPrice';

vi.mock('../usePythPrice', () => ({
    usePythDisplayPrice: vi.fn(),
    getPythFeedId: vi.fn(),
}));

describe('usePriceFeed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (getPythFeedId as any).mockReturnValue('0xfeed');
        (usePythDisplayPrice as any).mockReturnValue({ price: 0, loading: false, refetch: vi.fn() });
    });

    it('prefers pyth when positive', () => {
        (usePythDisplayPrice as any).mockReturnValue({ price: 100, loading: false, refetch: vi.fn() });
        const { result } = renderHook(() => usePriceFeed({ contractPrice: 99, apiPrice: 98 }));
        expect(result.current.price).toBe(100);
        expect(result.current.source).toBe('pyth');
        expect(result.current.isStale).toBe(false);
    });

    it('falls back to contract price', () => {
        const { result } = renderHook(() => usePriceFeed({ contractPrice: 50, apiPrice: 40 }));
        expect(result.current.price).toBe(50);
        expect(result.current.source).toBe('contract');
    });

    it('falls back to api price', () => {
        const { result } = renderHook(() => usePriceFeed({ apiPrice: 40 }));
        expect(result.current.price).toBe(40);
        expect(result.current.source).toBe('api');
    });

    it('reports none/stale when nothing resolves', () => {
        const { result } = renderHook(() => usePriceFeed({}));
        expect(result.current.price).toBe(0);
        expect(result.current.source).toBe('none');
        expect(result.current.isStale).toBe(true);
        expect(result.current.ageMs).toBe(Infinity);
    });

    it('is loading while pyth fetches and nothing resolved', () => {
        (usePythDisplayPrice as any).mockReturnValue({ price: 0, loading: true, refetch: vi.fn() });
        const { result } = renderHook(() => usePriceFeed({}));
        expect(result.current.isLoading).toBe(true);
    });

    it('does not resolve a pyth feed id when disabled', () => {
        renderHook(() => usePriceFeed({ symbol: 'BTC' }, { enabled: false }));
        expect(getPythFeedId).not.toHaveBeenCalled();
    });

    it('exposes refresh that calls pyth refetch', () => {
        const refetch = vi.fn();
        (usePythDisplayPrice as any).mockReturnValue({ price: 10, loading: false, refetch });
        const { result } = renderHook(() => usePriceFeed({}));
        act(() => { result.current.refresh(); });
        expect(refetch).toHaveBeenCalled();
    });

    it('updates freshness when the resolved price changes', () => {
        (usePythDisplayPrice as any).mockReturnValue({ price: 100, loading: false, refetch: vi.fn() });
        const { result, rerender } = renderHook((p: any) => usePriceFeed(p), { initialProps: { contractPrice: undefined } });
        expect(result.current.price).toBe(100);
        (usePythDisplayPrice as any).mockReturnValue({ price: 200, loading: false, refetch: vi.fn() });
        rerender({ contractPrice: undefined });
        expect(result.current.price).toBe(200);
        expect(result.current.source).toBe('pyth');
    });
});
