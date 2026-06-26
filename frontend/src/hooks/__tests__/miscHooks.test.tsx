import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useSound } from '../useSound';
import { useFocusTrap } from '../useFocusTrap';
import { getPythFeedId, usePythDisplayPrice } from '../usePythPrice';
import { useMarketPriceHistory } from '../useMarketPriceHistory';
import { useReferralUrl, getStoredRefCode, clearStoredRefCode } from '../useReferralUrl';
import { useQuery } from '@tanstack/react-query';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));

describe('useSound', () => {
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('no-ops when AudioContext is unavailable', () => {
        vi.stubGlobal('AudioContext', undefined);
        (window as any).webkitAudioContext = undefined;
        const { result } = renderHook(() => useSound());
        expect(() => result.current.playClick()).not.toThrow();
    });

    it('plays click/success/error beeps when AudioContext exists', () => {
        vi.useFakeTimers();
        const osc = { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
        const ctx = { createOscillator: () => osc, createGain: () => gain, destination: {}, currentTime: 0 };
        vi.stubGlobal('AudioContext', vi.fn(function () { return ctx; }));
        const { result } = renderHook(() => useSound());
        act(() => { result.current.playClick(); });
        act(() => { result.current.playSuccess(); vi.advanceTimersByTime(120); });
        act(() => { result.current.playError(); vi.advanceTimersByTime(160); });
        expect(osc.start).toHaveBeenCalled();
    });
});

describe('useFocusTrap', () => {
    function Trapped({ active }: { active: boolean }) {
        const ref = useFocusTrap(active);
        return (
            <div ref={ref}>
                <button>first</button>
                <button>last</button>
            </div>
        );
    }

    it('traps Tab and Shift+Tab focus within the container', () => {
        const { getByText, container } = render(<Trapped active />);
        const first = getByText('first');
        const last = getByText('last');
        const wrap = container.firstChild as HTMLElement;
        last.focus();
        fireEvent.keyDown(wrap, { key: 'Tab' });
        expect(document.activeElement).toBe(first);
        first.focus();
        fireEvent.keyDown(wrap, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
        // non-Tab key is ignored
        fireEvent.keyDown(wrap, { key: 'Enter' });
    });

    it('does nothing when inactive', () => {
        expect(() => render(<Trapped active={false} />)).not.toThrow();
    });
});

describe('getPythFeedId', () => {
    it('resolves by address, then symbol, then undefined', () => {
        expect(getPythFeedId('0x986a383f6de4a24dd3f524f0f93546229b58265f')).toMatch(/^0x/);
        expect(getPythFeedId('0xunknown', 'ETH-USD')).toMatch(/^0x/);
        expect(getPythFeedId('', 'NOPE')).toBeUndefined();
    });
});

describe('usePythDisplayPrice', () => {
    beforeEach(() => { global.fetch = vi.fn(); });

    it('returns null with no feedId', async () => {
        const { result } = renderHook(() => usePythDisplayPrice(undefined));
        await act(async () => {});
        expect(result.current.price).toBeNull();
    });

    it('fetches and parses a price', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ parsed: [{ price: { price: '500000', expo: -2 } }] }) });
        const { result } = renderHook(() => usePythDisplayPrice('0xfeed'));
        await act(async () => { await result.current.refetch(); });
        expect(result.current.price).toBe(5000);
    });

    it('ignores a non-ok response', async () => {
        (global.fetch as any).mockResolvedValue({ ok: false });
        const { result } = renderHook(() => usePythDisplayPrice('0xfeed'));
        await act(async () => { await result.current.refetch(); });
        expect(result.current.price).toBeNull();
    });
});

describe('useMarketPriceHistory.queryFn', () => {
    beforeEach(() => { vi.clearAllMocks(); global.fetch = vi.fn(); });

    function getQueryFn() {
        (useQuery as any).mockReturnValue({ data: [], isLoading: false, error: null });
        renderHook(() => useMarketPriceHistory('0xMkt', 7));
        return (useQuery as any).mock.calls[0][0].queryFn;
    }

    it('returns [] when no market address', async () => {
        (useQuery as any).mockReturnValue({ data: [], isLoading: false, error: null });
        renderHook(() => useMarketPriceHistory(undefined));
        const qf = (useQuery as any).mock.calls[0][0].queryFn;
        await expect(qf()).resolves.toEqual([]);
    });

    it('returns parsed data on success', async () => {
        (global.fetch as any).mockResolvedValue({ json: async () => ({ success: true, data: [{ timestamp: 1, value: 2 }] }) });
        const qf = getQueryFn();
        await expect(qf()).resolves.toEqual([{ timestamp: 1, value: 2 }]);
    });

    it('returns [] on failure', async () => {
        (global.fetch as any).mockResolvedValue({ json: async () => ({ success: false }) });
        const qf = getQueryFn();
        await expect(qf()).resolves.toEqual([]);
    });
});

describe('useReferralUrl', () => {
    afterEach(() => localStorage.clear());

    it('stores a ref code from the URL and clears the param', () => {
        const wrapper = ({ children }: any) => (
            <MemoryRouter initialEntries={['/?ref=partner1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
        );
        renderHook(() => useReferralUrl(), { wrapper });
        expect(getStoredRefCode()).toBe('PARTNER1');
        clearStoredRefCode();
        expect(getStoredRefCode()).toBeNull();
    });

    it('ignores too-short ref codes', () => {
        const wrapper = ({ children }: any) => (
            <MemoryRouter initialEntries={['/?ref=ab']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
        );
        renderHook(() => useReferralUrl(), { wrapper });
        expect(getStoredRefCode()).toBeNull();
    });
});
