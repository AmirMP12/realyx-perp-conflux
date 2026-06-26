import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.stubEnv('VITE_WS_URL', 'ws://localhost:3002');

import { useWebSocket, useRealtimePrices } from '../useWebSocket';
import { useMarketsStore, useStatsStore } from '../../stores';

vi.mock('../../stores', () => ({ useMarketsStore: vi.fn(), useStatsStore: vi.fn() }));

describe('useWebSocket heartbeat + realtime prices', () => {
    let wsInstance: any;

    class MockWebSocket {
        static OPEN = 1; static CLOSED = 3; static CONNECTING = 0; static CLOSING = 2;
        onopen: any; onmessage: any; onclose: any; onerror: any;
        send = vi.fn();
        close = vi.fn(() => { this.readyState = MockWebSocket.CLOSED; if (this.onclose) this.onclose(); });
        readyState = MockWebSocket.OPEN;
        constructor(public url: string) { wsInstance = this; }
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function (url: string) { return new MockWebSocket(url); }));
        (global.WebSocket as any).OPEN = MockWebSocket.OPEN;
        const updateMarketByAddress = vi.fn();
        const setStats = vi.fn();
        const marketsState = [{ marketAddress: '0x1', indexPrice: 1 }];
        (useMarketsStore as any).mockImplementation((sel: any) => sel({ updateMarketByAddress, markets: marketsState }));
        (useStatsStore as any).mockImplementation((sel: any) => sel({ setStats }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('sends a heartbeat ping on the interval and closes on heartbeat timeout', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        // Advance to trigger the heartbeat interval (15s) -> ping sent.
        act(() => { vi.advanceTimersByTime(15_100); });
        const pinged = wsInstance.send.mock.calls.some((c: any[]) => String(c[0]).includes('ping'));
        expect(pinged).toBe(true);
        // No inbound message -> heartbeat timeout (10s) closes the socket.
        act(() => { vi.advanceTimersByTime(10_100); });
        expect(wsInstance.close).toHaveBeenCalled();
    });

    it('cancels the heartbeat timeout when a message arrives (markAlive)', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        act(() => { vi.advanceTimersByTime(15_000); }); // ping + arm timeout
        // pong/any message cancels the pending liveness timeout.
        act(() => { wsInstance.onmessage({ data: JSON.stringify({ type: 'pong' }) }); });
        wsInstance.close.mockClear();
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(wsInstance.close).not.toHaveBeenCalled();
    });

    it('useRealtimePrices exposes connection state and markets', () => {
        const { result } = renderHook(() => useRealtimePrices());
        expect(result.current).toHaveProperty('connected');
        expect(result.current).toHaveProperty('markets');
    });
});
