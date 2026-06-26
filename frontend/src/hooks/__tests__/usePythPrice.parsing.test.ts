import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePythDisplayPrice } from '../usePythPrice';

describe('usePythDisplayPrice fetch handling', () => {
    beforeEach(() => { vi.clearAllMocks(); global.fetch = vi.fn(); });

    it('ignores a parsed entry with no price', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ parsed: [{}] }) });
        const { result } = renderHook(() => usePythDisplayPrice('feed-no-0x'));
        await act(async () => { await result.current.refetch(); });
        expect(result.current.price).toBeNull();
    });

    it('ignores a non-finite price string', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ parsed: [{ price: { price: 'abc', expo: -2 } }] }) });
        const { result } = renderHook(() => usePythDisplayPrice('0xfeed'));
        await act(async () => { await result.current.refetch(); });
        expect(result.current.price).toBeNull();
    });

    it('ignores a non-positive normalized price', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ parsed: [{ price: { price: '0', expo: -2 } }] }) });
        const { result } = renderHook(() => usePythDisplayPrice('0xfeed'));
        await act(async () => { await result.current.refetch(); });
        expect(result.current.price).toBeNull();
    });

    it('swallows fetch errors', async () => {
        (global.fetch as any).mockRejectedValue(new Error('net'));
        const { result } = renderHook(() => usePythDisplayPrice('0xfeed'));
        await act(async () => { await result.current.refetch(); });
        expect(result.current.price).toBeNull();
    });
});
