import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, render } from '@testing-library/react';
import { useSound } from '../useSound';
import { useFocusTrap } from '../useFocusTrap';

describe('useSound webkit fallback', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('uses webkitAudioContext when AudioContext is absent', () => {
        const ctx = {
            createOscillator: () => ({ type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }),
            createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
            destination: {}, currentTime: 0,
        };
        vi.stubGlobal('AudioContext', undefined);
        (window as any).webkitAudioContext = vi.fn(function () { return ctx; });
        const { result } = renderHook(() => useSound());
        expect(() => result.current.playClick()).not.toThrow();
        delete (window as any).webkitAudioContext;
    });
});

describe('useFocusTrap edge cases', () => {
    it('does nothing when the container has no focusable elements', () => {
        function Empty() {
            const ref = useFocusTrap(true);
            return <div ref={ref}><span>no focusables</span></div>;
        }
        expect(() => render(<Empty />)).not.toThrow();
    });
});
