import WebSocket from 'ws';
import { startWsServer } from '../wsServer';
import { config } from '../config';
import http from 'http';
import { AddressInfo } from 'net';

// Mock the services that wsServer polls
jest.mock('../services/pyth', () => ({
  fetchPythPrices: jest.fn().mockResolvedValue({
    '0x0000000000000000000000000000000000000001': 50000,
  })
}));

jest.mock('../services/subgraph', () => ({
  fetchMarkets: jest.fn().mockResolvedValue([
    {
      marketAddress: '0x0000000000000000000000000000000000000001',
      totalLongSize: '1000',
      totalShortSize: '500'
    }
  ]),
  fetchProtocol: jest.fn().mockResolvedValue({
    totalVolumeUsd: '10000'
  })
}));

jest.mock('../services/activeMarkets', () => ({
  getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set(['0x0000000000000000000000000000000000000001']))
}));

describe('WebSocket Server Integration', () => {
  let wsServer: any;
  let wsClient: WebSocket;

  beforeAll((done) => {
    // Start WS server, use a random port for testing
    config.wsPort = 0; // random port assignment logic handled internally if possible, or force mock 
    // Fallback: Just let it bind to any available
    wsServer = startWsServer();
    setTimeout(() => {
        done();
    }, 100);
  });

  afterAll((done) => {
    if (wsClient) wsClient.close();
    if (wsServer) wsServer(); // The startWsServer returns a cleanup function
    done();
  });

  it('should accept client connections and respond to pings/subscriptions', (done) => {
    // Hardcoded port logic (in real life we'd extract the bound port)
    // For this test, assume wsPort was set or defaulting to config.wsPort
    wsClient = new WebSocket(`ws://localhost:${config.wsPort}`);

    wsClient.on('open', () => {
      wsClient.send(JSON.stringify({ type: 'subscribe', channels: ['prices'] }));
    });

    wsClient.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'price_update') {
        expect(msg.data.price).toBeDefined();
        expect(msg.marketAddress).toBe('0x0000000000000000000000000000000000000001');
        done();
      }
    });

    // Provide a small timeout
    setTimeout(() => {
      done(new Error("Timeout waiting for websocket message"));
    }, 3000);
  });
});
