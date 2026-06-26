import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery, useIsDesktop } from '../useMediaQuery';

type Listener = () => void;

/** Builds a controllable matchMedia mock and returns helpers to drive it. */
function installMatchMedia(initialMatches: boolean) {
    let matches = initialMatches;
    const listeners = new Set<Listener>();
    const queries: string[] = [];

    const mql = (query: string) => {
        queries.push(query);
        return {
            get matches() {
                return matches;
            },
            media: query,
            addEventListener: (_evt: string, cb: Listener) => listeners.add(cb),
            removeEventListener: (_evt: string, cb: Listener) => listeners.delete(cb),
            // Legacy API (unused by the hook but harmless to provide).
            addListener: (cb: Listener) => listeners.add(cb),
            removeListener: (cb: Listener) => listeners.delete(cb),
            dispatchEvent: () => true,
        } as unknown as MediaQueryList;
    };

    const fn = vi.fn(mql);
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: fn });

    return {
        fn,
        queries,
        setMatches(next: boolean) {
            matches = next;
            listeners.forEach((cb) => cb());
        },
        listenerCount: () => listeners.size,
    };
}

describe('useMediaQuery', () => {
    let original: typeof window.matchMedia | undefined;

    beforeEach(() => {
        original = window.matchMedia;
    });

    afterEach(() => {
        if (original) {
            Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
        } else {
            // @ts-expect-error - intentionally removing for the SSR-safety path.
            delete window.matchMedia;
        }
        vi.restoreAllMocks();
    });

    it('returns the initial match state', () => {
        installMatchMedia(true);
        const { result } = renderHook(() => useMediaQuery('(min-width: 600px)'));
        expect(result.current).toBe(true);
    });

    it('updates when the media query changes', () => {
        const mm = installMatchMedia(false);
        const { result } = renderHook(() => useMediaQuery('(min-width: 600px)'));
        expect(result.current).toBe(false);

        act(() => mm.setMatches(true));
        expect(result.current).toBe(true);

        act(() => mm.setMatches(false));
        expect(result.current).toBe(false);
    });

    it('subscribes and unsubscribes from the media query list', () => {
        const mm = installMatchMedia(false);
        const { unmount } = renderHook(() => useMediaQuery('(min-width: 600px)'));
        expect(mm.listenerCount()).toBe(1);
        unmount();
        expect(mm.listenerCount()).toBe(0);
    });

    it('returns false when matchMedia is unavailable (SSR-safe)', () => {
        // @ts-expect-error - simulate an environment without matchMedia.
        delete window.matchMedia;
        const { result } = renderHook(() => useMediaQuery('(min-width: 600px)'));
        expect(result.current).toBe(false);
    });

    it('useIsDesktop queries the lg breakpoint (1024px)', () => {
        const mm = installMatchMedia(true);
        const { result } = renderHook(() => useIsDesktop());
        expect(result.current).toBe(true);
        expect(mm.queries.some((q) => q.includes('1024px'))).toBe(true);
    });
});
