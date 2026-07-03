import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePriceFeed } from '../usePriceFeed';
import { usePythDisplayPrice, getPythFeedId } from '../usePythPrice';

vi.mock('../usePythPrice', () => ({ usePythDisplayPrice: vi.fn(), getPythFeedId: vi.fn() }));

describe('usePriceFeed interval freshness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (getPythFeedId as any).mockReturnValue('0xfeed');
        (usePythDisplayPrice as any).mockReturnValue({ price: 100, loading: false, refetch: vi.fn() });
    });
    afterEach(() => vi.useRealTimers());

    it('advances ageMs and flips to stale via the 1s interval tick', () => {
        const { result } = renderHook(() => usePriceFeed({}, { staleAfterMs: 2000 }));
        expect(result.current.isStale).toBe(false);
        // Drive the setInterval(setTick) callback several times so ageMs grows past staleAfterMs.
        act(() => { vi.advanceTimersByTime(3000); });
        expect(result.current.ageMs).toBeGreaterThanOrEqual(2000);
        expect(result.current.isStale).toBe(true);
    });
});
