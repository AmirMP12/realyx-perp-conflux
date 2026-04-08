import { jest } from '@jest/globals';
import { startWsServer } from '../wsServer.js';
import WebSocket from 'ws';
import { config } from '../config.js';

jest.mock('../services/pyth.js', () => ({
  fetchPythPrices: (jest as any).fn().mockResolvedValue({
    '0x0000000000000000000000000000000000000001': 50000,
  }),
}));

jest.mock('../services/subgraph.js', () => ({
  fetchMarkets: (jest as any).fn().mockResolvedValue([
    {
      marketAddress: '0x0000000000000000000000000000000000000001',
      totalLongSize: '1000',
      totalShortSize: '500',
    },
  ]),
  fetchProtocol: (jest as any).fn().mockResolvedValue({
    totalVolumeUsd: '10000',
  }),
}));

jest.mock('../services/activeMarkets.js', () => ({
  getActiveMarketAddresses: (jest as any).fn().mockResolvedValue(
    new Set(['0x0000000000000000000000000000000000000001'])
  ),
}));

jest.setTimeout(15000);

describe('wsServer Coverage', () => {
  let stop: () => void;

  beforeAll(() => {
    stop = startWsServer();
  });

  afterAll(() => {
    if (stop) stop();
  });

  it('should handle connections and messages', (done) => {
    const ws = new WebSocket(`ws://localhost:${config.wsPort}`);
    
    ws.on('open', () => {
      // 1. Valid subscribe
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['prices'] }));
      
      // 2. Invalid JSON (coverage for catch block)
      ws.send('invalid json');
      
      // 3. Close connection
      setTimeout(() => {
        ws.close();
      }, 500);
    });

    ws.on('close', () => {
      done();
    });

    ws.on('error', (err) => {
      done(err);
    });
  }, 10000);

  it('should handle concurrent connections', async () => {
    const ws1 = new WebSocket(`ws://localhost:${config.wsPort}`);
    const ws2 = new WebSocket(`ws://localhost:${config.wsPort}`);
    
    await Promise.all([
      new Promise((resolve) => ws1.on('open', resolve)),
      new Promise((resolve) => ws2.on('open', resolve)),
    ]);
    
    ws1.close();
    ws2.close();
    
    await Promise.all([
      new Promise((resolve) => ws1.on('close', resolve)),
      new Promise((resolve) => ws2.on('close', resolve)),
    ]);
  });
});
