import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePythPriceHistory } from '../usePythPriceHistory';

describe('usePythPriceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Ensure we are using real timers to avoid conflicts with waitFor and async fetch
    vi.useRealTimers();
  });

  it('fetches price history correctly', async () => {
    const mockFeedId = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
    const mockPriceResponse = {
      parsed: [{
        price: {
          price: '5000000',
          expo: '-2'
        }
      }]
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockPriceResponse,
    });

    const { result } = renderHook(() => usePythPriceHistory(mockFeedId, 60, 2));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    }, { timeout: 15000 });

    expect(result.current.data.length).toBe(2);
    expect(result.current.data[0].close).toBe(50000);
  });

  it('handles fetch errors', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => usePythPriceHistory('some-id', 60, 1));

    await waitFor(() => {
      // The hook catches individual fetch errors and returns null, 
      // which eventually leads to this error message if all fail.
      expect(result.current.error).toBe('No price data available for this market');
    }, { timeout: 15000 });
    
    expect(result.current.loading).toBe(false);
  }, 20000);

  it('handles empty feedId', () => {
    const { result } = renderHook(() => usePythPriceHistory(undefined));
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
