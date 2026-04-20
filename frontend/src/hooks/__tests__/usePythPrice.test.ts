import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePythDisplayPrice, getPythFeedId } from '../usePythPrice';

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
    });
});
