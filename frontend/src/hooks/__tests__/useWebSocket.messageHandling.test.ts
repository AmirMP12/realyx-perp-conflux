import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.stubEnv('VITE_WS_URL', 'ws://localhost:3002');

import { useWebSocket } from '../useWebSocket';
import { useMarketsStore, useStatsStore } from '../../stores';

vi.mock('../../stores', () => ({ useMarketsStore: vi.fn(), useStatsStore: vi.fn() }));

describe('useWebSocket message handling', () => {
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
    afterEach(() => { vi.clearAllMocks(); });

    function send(msg: any) {
        act(() => { wsInstance.onmessage({ data: JSON.stringify(msg) }); });
    }

    it('handles price_update via indexPrice fallback and data.marketAddress', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        send({ type: 'price_update', data: { marketAddress: '0xA', indexPrice: 123, change24h: 1 } });
        expect(updateMarketByAddress).toHaveBeenCalledWith('0xA', expect.objectContaining({ indexPrice: 123 }));
    });

    it('ignores price_update with no address', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        updateMarketByAddress.mockClear();
        send({ type: 'price_update', data: { price: 100 } });
        expect(updateMarketByAddress).not.toHaveBeenCalled();
    });

    it('handles stats_update via markets fallback field', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        send({ type: 'stats_update', data: { volume24h: '5', markets: 7 } });
        expect(setStats).toHaveBeenCalledWith({ volume24h: 5, markets: 7 });
    });

    it('ignores funding_update with no address or rate', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        updateMarketByAddress.mockClear();
        send({ type: 'funding_update', data: {} });
        expect(updateMarketByAddress).not.toHaveBeenCalled();
    });

    it('ignores ping/pong liveness messages', () => {
        renderHook(() => useWebSocket());
        act(() => { wsInstance.onopen(); });
        send({ type: 'pong' });
        send({ type: 'ping' });
        expect(setStats).not.toHaveBeenCalled();
    });
});
