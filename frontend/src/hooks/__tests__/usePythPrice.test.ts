import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePythDisplayPrice, usePyth24hChange, getPythFeedId } from '../usePythPrice';

describe('usePythPrice', () => {
    const mockFeedId = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'; // BTC
    const mockPriceResponse = {
        parsed: [{
            price: {
                price: '6500000',
                expo: -2,
            }
        }]
    };

    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockPriceResponse),
        } as any);
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    describe('getPythFeedId', () => {
        it('returns correctly for known market address', () => {
            const btcAddr = '0x986a383f6de4a24dd3f524f0f93546229b58265f';
            expect(getPythFeedId(btcAddr)).toBe(mockFeedId);
        });

        it('returns correctly for known symbol fallback', () => {
            expect(getPythFeedId('', 'BTC-USD')).toBe(mockFeedId);
        });

        it('returns undefined for unknown', () => {
            expect(getPythFeedId('unknown')).toBeUndefined();
        });
    });

    describe('usePythDisplayPrice', () => {
        it('fetches price and sets state', async () => {
            const { result } = renderHook(() => usePythDisplayPrice(mockFeedId));
            
            await waitFor(() => {
                expect(result.current.price).toBe(65000);
                expect(result.current.loading).toBe(false);
            }, { timeout: 3000 });
        });

        it.skip('polls for price updates', async () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => usePythDisplayPrice(mockFeedId));
            
            // Allow first effect/fetch to run
            await act(async () => {
                vi.advanceTimersByTime(0);
            });
            
            await waitFor(() => expect(result.current.price).toBe(65000), { timeout: 3000 });
            
            // Setup second response
            const updatedResponse = {
                parsed: [{
                    price: {
                        price: '6600000',
                        expo: -2,
                    }
                }]
            };
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(updatedResponse),
            } as any);

            // Advance timers by 2 seconds to trigger next poll
            await act(async () => {
                vi.advanceTimersByTime(2000);
            });

            await waitFor(() => {
                expect(result.current.price).toBe(66000);
            }, { timeout: 3000 });
            
            vi.useRealTimers();
        });

        it('handles fetch errors gracefully', async () => {
            (global.fetch as any).mockRejectedValue(new Error('Network error'));
            const { result } = renderHook(() => usePythDisplayPrice(mockFeedId));
            
            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            }, { timeout: 3000 });
            expect(result.current.price).toBeNull();
        });

        it('handles non-ok responses', async () => {
            (global.fetch as any).mockResolvedValue({
                ok: false,
            } as any);
            const { result } = renderHook(() => usePythDisplayPrice(mockFeedId));
            
            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            }, { timeout: 3000 });
            expect(result.current.price).toBeNull();
        });

        it('stays null when feedId is undefined and never fetches', async () => {
            const { result } = renderHook(() => usePythDisplayPrice(undefined));
            await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
            expect(result.current.price).toBeNull();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('ignores a response with no parsed price', async () => {
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ parsed: [] }),
            } as any);
            const { result } = renderHook(() => usePythDisplayPrice(mockFeedId));
            await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
            expect(result.current.price).toBeNull();
        });

        it('does not set a non-positive normalized price', async () => {
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ parsed: [{ price: { price: '0', expo: -2 } }] }),
            } as any);
            const { result } = renderHook(() => usePythDisplayPrice(mockFeedId));
            await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
            expect(result.current.price).toBeNull();
        });

        it('accepts a feedId without the 0x prefix', async () => {
            const { result } = renderHook(() => usePythDisplayPrice(mockFeedId.slice(2)));
            await waitFor(() => expect(result.current.price).toBe(65000), { timeout: 3000 });
        });
    });

    describe('usePyth24hChange', () => {
        it('returns null and never fetches when feedId is undefined', async () => {
            const { result } = renderHook(() => usePyth24hChange(undefined));
            // Let the effect run.
            await act(async () => { await Promise.resolve(); });
            expect(result.current).toBeNull();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('computes the percentage change from latest vs past prices', async () => {
            (global.fetch as any).mockImplementation((url: string) =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            parsed: [{ price: { price: url.includes('/latest') ? '6600000' : '6000000', expo: -2 } }],
                        }),
                } as any),
            );
            const { result } = renderHook(() => usePyth24hChange(mockFeedId));
            // 66000 vs 60000 -> +10%
            await waitFor(() => expect(result.current).toBeCloseTo(10), { timeout: 3000 });
        });

        it('keeps null when either response is not ok', async () => {
            (global.fetch as any).mockResolvedValue({ ok: false } as any);
            const { result } = renderHook(() => usePyth24hChange(mockFeedId));
            await act(async () => { await Promise.resolve(); });
            expect(result.current).toBeNull();
        });

        it('keeps null when a parsed price is missing', async () => {
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ parsed: [] }),
            } as any);
            const { result } = renderHook(() => usePyth24hChange(mockFeedId));
            await act(async () => { await Promise.resolve(); });
            expect(result.current).toBeNull();
        });

        it('does not compute change when a price is non-positive', async () => {
            (global.fetch as any).mockImplementation((url: string) =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            parsed: [{ price: { price: url.includes('/latest') ? '6600000' : '0', expo: -2 } }],
                        }),
                } as any),
            );
            const { result } = renderHook(() => usePyth24hChange(mockFeedId));
            await act(async () => { await Promise.resolve(); });
            expect(result.current).toBeNull();
        });

        it('swallows fetch errors and keeps the last value', async () => {
            (global.fetch as any).mockRejectedValue(new Error('Network error'));
            const { result } = renderHook(() => usePyth24hChange(mockFeedId));
            await act(async () => { await Promise.resolve(); });
            expect(result.current).toBeNull();
        });

        it('accepts a feedId without the 0x prefix', async () => {
            (global.fetch as any).mockImplementation((url: string) =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            parsed: [{ price: { price: url.includes('/latest') ? '6600000' : '6000000', expo: -2 } }],
                        }),
                } as any),
            );
            const { result } = renderHook(() => usePyth24hChange(mockFeedId.slice(2)));
            await waitFor(() => expect(result.current).toBeCloseTo(10), { timeout: 3000 });
        });
    });
});
