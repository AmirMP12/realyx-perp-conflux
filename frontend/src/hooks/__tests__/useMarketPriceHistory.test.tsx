import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMarketPriceHistory } from '../useMarketPriceHistory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
vi.unmock('@tanstack/react-query');

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    {children}
  </QueryClientProvider>
);

describe('useMarketPriceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('fetches market price history', async () => {
    const mockData = {
      success: true,
      data: [
        { timestamp: 1000, value: 50000 },
        { timestamp: 2000, value: 51000 },
      ],
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const { result } = renderHook(() => useMarketPriceHistory('0x123', 7), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.prices).toEqual(mockData.data);
  });

  it('handles API error', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    });

    const { result } = renderHook(() => useMarketPriceHistory('0x123', 7), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.prices).toEqual([]);
  });

  it('skips fetch if marketAddress is missing', () => {
    const { result } = renderHook(() => useMarketPriceHistory(undefined), { wrapper });
    expect(result.current.prices).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
