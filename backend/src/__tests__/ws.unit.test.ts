import { jest } from '@jest/globals';
import { WebSocket } from 'ws';

describe('WebSocket Server Logic Paths', () => {
    let startWsServer: any;
    let pyth: any;
    let indexer: any;
    let activeMarkets: any;

    beforeEach(async () => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        
        jest.doMock('ws', () => {
            const mWS = {
                on: jest.fn(),
                send: jest.fn(),
                readyState: 1,
                ping: jest.fn(),
                terminate: jest.fn(),
            };
            const mWSS = {
                on: jest.fn(),
                close: jest.fn(),
            };
            return {
                WebSocketServer: jest.fn(() => mWSS),
                WebSocket: jest.fn(() => mWS),
            };
        });

        jest.doMock('../services/pyth.js', () => ({
            fetchPythPrices: jest.fn().mockResolvedValue({ '0x1': 100 }),
        }));
        jest.doMock('../services/indexer.js', () => ({
            fetchMarkets: jest.fn().mockResolvedValue([{ marketAddress: '0x1', totalLongSize: '100', totalShortSize: '100' }]),
            fetchProtocol: jest.fn().mockResolvedValue({ totalVolumeUsd: '500' }),
        }));
        jest.doMock('../services/activeMarkets.js', () => ({
            getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set(['0x1'])),
        }));

        pyth = await import('../services/pyth.js');
        indexer = await import('../services/indexer.js');
        activeMarkets = await import('../services/activeMarkets.js');
        
        const mod = await import('../wsServer.js');
        startWsServer = mod.startWsServer;
    });

    it('handles poll error and fallbacks to last data', async () => {
        const stop = startWsServer();
        
        // Trigger poll manually or wait for POLL_MS (500ms in test)
        pyth.fetchPythPrices.mockRejectedValueOnce(new Error("Poll Fail"));
        
        // Wait for poll
        await new Promise(r => setTimeout(r, 600));
        
        stop();
    });

    it('handles broadcast to clients with specific channel subscriptions', async () => {
        const { WebSocketServer } = require('ws');
        const mWS = {
            on: jest.fn(),
            send: jest.fn(),
            readyState: 1,
            channels: ['stats'], // Only stats
            isAlive: true,
            ping: jest.fn(),
        };
        
        // Inject client into the server (this is tricky since clients Set is internal)
        // We can mock the connection event
        const stop = startWsServer();
        const wssInstance = WebSocketServer.mock.results[0].value;
        const connectionHandler = wssInstance.on.mock.calls.find((c: any) => c[0] === 'connection')[1];
        
        connectionHandler(mWS, { socket: { remoteAddress: '1.2.3.4' } });
        
        // Trigger a broadcast by forcing a poll
        await new Promise(r => setTimeout(r, 600));
        
        // mWS should have received stats_update but NOT price_update
        const sends = mWS.send.mock.calls.map((c: any) => JSON.parse(c[0]).type);
        expect(sends).toContain('stats_update');
        expect(sends).not.toContain('price_update');
        
        stop();
    });

    it('handles heartbeat termination', async () => {
        jest.useFakeTimers();
        const stop = startWsServer();
        const { WebSocketServer } = require('ws');
        const wssInstance = WebSocketServer.mock.results[0].value;
        const connectionHandler = wssInstance.on.mock.calls.find((c: any) => c[0] === 'connection')[1];
        
        const deadWS = {
            on: jest.fn(),
            isAlive: false,
            terminate: jest.fn(),
            ping: jest.fn(),
        };
        connectionHandler(deadWS, { socket: {} });
        
        // Run heartbeat (30s * 2 + buffer)
        jest.advanceTimersByTime(65000);
        
        expect(deadWS.terminate).toHaveBeenCalled();
        
        jest.useRealTimers();
        stop();
    });
});
