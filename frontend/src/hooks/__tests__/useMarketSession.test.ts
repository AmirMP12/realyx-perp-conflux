import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarketSession } from '../useMarketSession';

describe('useMarketSession', () => {
    afterEach(() => vi.useRealTimers());

    it('returns always-open for crypto', () => {
        const { result } = renderHook(() => useMarketSession('CRYPTO'));
        expect(result.current.isAlwaysOpen).toBe(true);
    });

    it('re-evaluates on the interval', () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useMarketSession('STOCK', 1000));
        expect(result.current.isAlwaysOpen).toBe(false);
        act(() => { vi.advanceTimersByTime(1100); });
        expect(result.current.state).toMatch(/open|closed/);
    });
});
