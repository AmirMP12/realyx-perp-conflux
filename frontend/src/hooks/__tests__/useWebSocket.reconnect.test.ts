import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.stubEnv('VITE_WS_URL', 'ws://localhost:3002');

import { useWebSocket } from '../useWebSocket';
import { useMarketsStore, useStatsStore } from '../../stores';

vi.mock('../../stores', () => ({ useMarketsStore: vi.fn(), useStatsStore: vi.fn() }));

describe('useWebSocket reconnect/heartbeat internals', () => {
    let instances: any[] = [];
    const updateMarketByAddress = vi.fn();
    const setStats = vi.fn();

    class MockWebSocket {
        static OPEN = 1; static CLOSED = 3;
        onopen: any; onmessage: any; onclose: any; onerror: any;
        send = vi.fn(); close = vi.fn(() => { this.readyState = MockWebSocket.CLOSED; });
        readyState = 1;
        constructor(public url: string) { instances.push(this); }
    }

    beforeEach(() => {
        vi.useFakeTimers();
        instances = [];
        vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function (url: string) { return new MockWebSocket(url); }));
        (global.WebSocket as any).OPEN = 1;
        (useMarketsStore as any).mockImplementation((sel: any) => sel({ updateMarketByAddress, markets: [] }));
        (useStatsStore as any).mockImplementation((sel: any) => sel({ setStats }));
    });
    afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

    it('reconnects with exponential backoff across multiple closes', () => {
        renderHook(() => useWebSocket());
        const first = instances[0];
        act(() => { first.onopen(); });
        // close -> schedule reconnect (attempt 0)
        act(() => { first.readyState = 3; first.onclose(); });
        act(() => { vi.advanceTimersByTime(5000); });
        expect(instances.length).toBeGreaterThanOrEqual(2);
        // second close -> larger backoff (attempt 1)
        const second = instances[instances.length - 1];
        act(() => { second.onopen(); });
        act(() => { second.readyState = 3; second.onclose(); });
        act(() => { vi.advanceTimersByTime(10000); });
        expect(instances.length).toBeGreaterThanOrEqual(3);
    });

    it('survives a heartbeat send failure', () => {
        renderHook(() => useWebSocket());
        const ws = instances[0];
        // Only the heartbeat ping throws; the initial subscribe send succeeds.
        ws.send = vi.fn((msg: any) => { if (String(msg).includes('ping')) throw new Error('send failed'); });
        act(() => { ws.onopen(); });
        // advance to the heartbeat interval -> send throws, caught, timeout armed
        act(() => { vi.advanceTimersByTime(15_100); });
        // heartbeat timeout fires -> close
        act(() => { vi.advanceTimersByTime(10_100); });
        expect(ws.close).toHaveBeenCalled();
    });

    it('onerror closes the socket', () => {
        renderHook(() => useWebSocket());
        const ws = instances[0];
        act(() => { ws.onopen(); });
        act(() => { ws.onerror(new Event('error')); });
        expect(ws.close).toHaveBeenCalled();
    });

    it('does not reconnect after unmount', () => {
        const { unmount } = renderHook(() => useWebSocket());
        const ws = instances[0];
        act(() => { ws.onopen(); });
        unmount();
        const count = instances.length;
        act(() => { vi.advanceTimersByTime(30000); });
        expect(instances.length).toBe(count);
    });
});
