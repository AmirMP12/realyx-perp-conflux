import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Set env BEFORE importing hook
vi.stubEnv('VITE_WS_URL', 'ws://localhost:3002');

import { useWebSocket } from '../useWebSocket';
import { useMarketsStore, useStatsStore } from '../../stores';

// Mock stores
vi.mock('../../stores', () => ({
    useMarketsStore: vi.fn(),
    useStatsStore: vi.fn(),
}));

describe('useWebSocket', () => {
    let wsInstance: any;
    const mockUpdateMarketByAddress = vi.fn();
    const mockSetStats = vi.fn();

    // Define WebSocket mock class
    class MockWebSocket {
        static OPEN = 1;
        static CLOSED = 3;
        static CONNECTING = 0;
        static CLOSING = 2;

        onopen: any;
        onmessage: any;
        onclose: any;
        onerror: any;
        send = vi.fn();
        close = vi.fn(() => {
            this.readyState = MockWebSocket.CLOSED;
            if (this.onclose) this.onclose();
        });
        readyState = MockWebSocket.OPEN;

        constructor(public url: string) {
            wsInstance = this;
        }
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function(url: string) {
            return new MockWebSocket(url);
        }));
        
        // Copy constants to the mock function
        (global.WebSocket as any).OPEN = MockWebSocket.OPEN;
        (global.WebSocket as any).CLOSED = MockWebSocket.CLOSED;
        (global.WebSocket as any).CONNECTING = MockWebSocket.CONNECTING;
        (global.WebSocket as any).CLOSING = MockWebSocket.CLOSING;
        
        // Mock stores return values
        (useMarketsStore as any).mockImplementation((selector: any) => selector({
            updateMarketByAddress: mockUpdateMarketByAddress,
        }));
        (useStatsStore as any).mockImplementation((selector: any) => selector({
            setStats: mockSetStats,
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('connects to websocket and subscribes on open', () => {
        renderHook(() => useWebSocket());
        
        expect(global.WebSocket).toHaveBeenCalled();
        
        // Simulate open
        act(() => {
            wsInstance.onopen();
        });
        
        expect(wsInstance.send).toHaveBeenCalledWith(JSON.stringify({
            type: 'subscribe',
            channels: ['prices', 'stats'],
        }));
    });

    it('handles price_update messages', () => {
        renderHook(() => useWebSocket());
        act(() => {
            wsInstance.onopen();
        });

        const priceMsg = {
            type: 'price_update',
            marketAddress: '0x123',
            data: {
                price: 50000,
                change24h: 5.5,
            }
        };
        
        // Simulate message
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify(priceMsg) });
        });

        expect(mockUpdateMarketByAddress).toHaveBeenCalledWith('0x123', expect.objectContaining({
            indexPrice: 50000,
            change24h: 5.5,
        }));
    });

    it('handles stats_update messages', () => {
        renderHook(() => useWebSocket());
        act(() => {
            wsInstance.onopen();
        });

        const statsMsg = {
            type: 'stats_update',
            data: {
                volume24h: '1000000',
                totalMarkets: 15,
            }
        };
        
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify(statsMsg) });
        });

        expect(mockSetStats).toHaveBeenCalledWith({
            volume24h: 1000000,
            markets: 15,
        });
    });

    it('reconnects after close', () => {
        renderHook(() => useWebSocket());
        
        act(() => {
            wsInstance.readyState = MockWebSocket.CLOSED;
            wsInstance.onclose();
        });
        
        // Reconnect after 3000ms
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        
        // Should have called WebSocket constructor again
        expect(global.WebSocket).toHaveBeenCalledTimes(2);
    });

    it('provides a send function', () => {
        const { result } = renderHook(() => useWebSocket());
        act(() => {
            wsInstance.onopen();
        });
        
        result.current.send({ type: 'ping' });
        expect(wsInstance.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
    });

    it('handles funding_update messages', () => {
        renderHook(() => useWebSocket());
        act(() => {
            wsInstance.onopen();
        });

        const fundingMsg = {
            type: 'funding_update',
            marketAddress: '0x123',
            data: { rate: 0.0001 }
        };
        
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify(fundingMsg) });
        });
        expect(mockUpdateMarketByAddress).toHaveBeenCalledWith('0x123', { fundingRate: 0.0001 });
    });

    it('handles price_update with missing marketAddress using msg.data', () => {
        renderHook(() => useWebSocket());
        act(() => {
            wsInstance.onopen();
        });

        const priceMsg = {
            type: 'price_update',
            data: {
                marketAddress: '0x456',
                price: 100
            }
        };
        
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify(priceMsg) });
        });
        expect(mockUpdateMarketByAddress).toHaveBeenCalledWith('0x456', expect.any(Object));
    });

    it('ignores price_update with zero or negative price', () => {
        renderHook(() => useWebSocket());
        act(() => {
            wsInstance.onopen();
        });

        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({
                type: 'price_update',
                marketAddress: '0x123',
                data: { price: 0 }
            })});
        });
        
        expect(mockUpdateMarketByAddress).not.toHaveBeenCalled();
    });

    it('handles invalid JSON in onmessage', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderHook(() => useWebSocket());
        act(() => {
            wsInstance.onopen();
        });
        
        act(() => {
            wsInstance.onmessage({ data: 'invalid json' });
        });
        expect(spy).toHaveBeenCalledWith('Failed to parse WS message:', expect.any(Error));
        spy.mockRestore();
    });

    it('closes and reconnects on websocket error', () => {
        renderHook(() => useWebSocket());
        
        act(() => {
            wsInstance.onerror();
        });
        
        expect(wsInstance.close).toHaveBeenCalled();
        
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(global.WebSocket).toHaveBeenCalledTimes(2);
    });

    it('schedules retry if WebSocket constructor throws', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        (global.WebSocket as any).mockImplementationOnce(function() {
            throw new Error('Connection failed');
        });
        
        renderHook(() => useWebSocket());
        
        expect(spy).toHaveBeenCalledWith('Failed to connect WebSocket:', expect.any(Error));
        
        // Should retry after 5000ms (catch block says 5000)
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        
        expect(global.WebSocket).toHaveBeenCalledTimes(2); // 1 (fail) + 1 (retry)
        // Wait, why 3? 1st (fail), then another one inside connect? 
        // Oh, the first one threw, so it sets a timeout for 5000ms.
        spy.mockRestore();
    });
});
