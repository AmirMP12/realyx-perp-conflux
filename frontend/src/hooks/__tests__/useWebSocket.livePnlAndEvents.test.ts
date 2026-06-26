import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.stubEnv('VITE_WS_URL', 'ws://localhost:3002');

import { useWebSocket, useLivePnL } from '../useWebSocket';
import { useMarketsStore, useStatsStore } from '../../stores';

vi.mock('../../stores', () => ({ useMarketsStore: vi.fn(), useStatsStore: vi.fn() }));

describe('useLivePnL non-finite inputs', () => {
    it('treats a non-finite size as zero', () => {
        const [r] = useLivePnL(
            [{ marketAddress: '0xM', entryPrice: '100', size: 'NaNxyz', isLong: true, pnl: '0' }],
            [{ marketAddress: '0xM', indexPrice: 120 }],
        );
        expect(r.livePnl).toBe(0);
    });

    it('falls back to entry when the market index price is not finite', () => {
        const [r] = useLivePnL(
            [{ marketAddress: '0xM', entryPrice: '100', size: '1000', isLong: true, pnl: '0' }],
            [{ marketAddress: '0xM', indexPrice: NaN }],
        );
        expect(r.markPrice).toBe(100);
        expect(r.livePnl).toBe(0);
    });
});

describe('useWebSocket heartbeat + funding success', () => {
    let wsInstance: any;
    const updateMarketByAddress = vi.fn();
    const setStats = vi.fn();

    class MockWebSocket {
        static OPEN = 1; static CLOSED = 3;
        onopen: any; onmessage: any; onclose: any; onerror: any;
        send = vi.fn(); close = vi.fn();
        readyState = 1;
        constructor(public url: string) { wsInstance = this; }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function (url: string) { return new MockWebSocket(url); }));
        (global.WebSocket as any).OPEN = 1;
        (useMarketsStore as any).mockImplementation((sel: any) => sel({ updateMarketByAddress, markets: [] }));
        (useStatsStore as any).mockImplementation((sel: any) => sel({ setStats }));
    });
    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

    it('applies a funding_update with address and rate', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        act(() => { wsInstance.onmessage({ data: JSON.stringify({ type: 'funding_update', marketAddress: '0xF', data: { rate: 0.01 } }) }); });
        expect(updateMarketByAddress).toHaveBeenCalledWith('0xF', { fundingRate: 0.01 });
    });

    it('logs and swallows an unparseable message', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        act(() => { wsInstance.onmessage({ data: 'not json{' }); });
        expect(err).toHaveBeenCalled();
    });

    it('sends a heartbeat ping and closes on liveness timeout', () => {
        vi.useFakeTimers();
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        wsInstance.send.mockClear();
        act(() => { vi.advanceTimersByTime(15_000); });
        expect(wsInstance.send).toHaveBeenCalledWith(expect.stringContaining('ping'));
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(wsInstance.close).toHaveBeenCalled();
    });

    it('skips the ping when the socket is not open', () => {
        vi.useFakeTimers();
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        wsInstance.send.mockClear();
        wsInstance.readyState = 3; // CLOSED
        act(() => { vi.advanceTimersByTime(15_000); });
        expect(wsInstance.send).not.toHaveBeenCalled();
    });

    it('onerror closes the socket', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        act(() => { wsInstance.onerror(); });
        expect(wsInstance.close).toHaveBeenCalled();
    });
});
