import WebSocket from 'ws';
import { jest } from '@jest/globals';
import { startWsServer } from '../wsServer.js';
import { config } from '../config.js';

jest.mock('../services/pyth.js', () => ({
  fetchPythPrices: (jest as any).fn().mockResolvedValue({
    '0x0000000000000000000000000000000000000001': 50000,
  })
}));

jest.mock('../services/subgraph.js', () => ({
  fetchMarkets: (jest as any).fn().mockResolvedValue([
    {
      marketAddress: '0x0000000000000000000000000000000000000001',
      totalLongSize: '1000',
      totalShortSize: '500'
    }
  ]),
  fetchProtocol: (jest as any).fn().mockResolvedValue({
    totalVolumeUsd: '10000'
  })
}));

jest.mock('../services/activeMarkets.js', () => ({
  getActiveMarketAddresses: (jest as any).fn().mockResolvedValue(new Set(['0x0000000000000000000000000000000000000001']))
}));

describe('WebSocket Server Integration', () => {
  let stopWsServer: any;
  let wsClient: WebSocket;
  const TEST_PORT = 3009;

  beforeAll((done) => {
    (config as any).wsPort = TEST_PORT;
    stopWsServer = startWsServer();
    setTimeout(done, 500);
  });

  afterAll((done) => {
    if (wsClient) wsClient.close();
    if (stopWsServer) stopWsServer();
    done();
  });

  it('should accept client connections and respond to subscriptions', (done) => {
    wsClient = new WebSocket(`ws://localhost:${TEST_PORT}`);

    let received = false;
    const timeout = setTimeout(() => {
      if (!received) done(new Error("Timeout waiting for websocket message"));
    }, 4000);

    wsClient.on('open', () => {
      wsClient.send(JSON.stringify({ type: 'subscribe', channels: ['prices'] }));
    });

    wsClient.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'price_update' && msg.data?.price != null) {
        expect(msg.data.price).toBe(50000);
        expect(msg.data.marketAddress).toBe('0x0000000000000000000000000000000000000001');
        received = true;
        clearTimeout(timeout);
        done();
      }
    });
  });
});
