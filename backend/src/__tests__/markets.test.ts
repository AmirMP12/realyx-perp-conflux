import request from 'supertest';
import { jest } from '@jest/globals';
import { app } from '../app.js';
import * as activeMarkets from '../services/activeMarkets.js';
import * as subServices from '../services/indexer.js';

jest.mock('../services/activeMarkets.js');
jest.mock('../services/indexer.js');
jest.mock('../services/coingecko.js', () => ({
  fetchCoinGeckoPrices: jest.fn().mockResolvedValue({}),
  getCoinGeckoIdForMarket: jest.fn().mockReturnValue(null)
}));
jest.mock('../services/pyth.js', () => ({
  fetchPythPrices: jest.fn().mockResolvedValue({}),
  fetchPyth24hChange: jest.fn().mockResolvedValue(0)
}));

describe('Markets API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should filter active markets and return output', async () => {
    const mockMarkets = [
      { id: '1', marketAddress: '0x986a383f6de4a24dd3f524f0f93546229b58265f', totalLongSize: '10', totalShortSize: '5', totalLongCost: '100', totalShortCost: '50' },
      { id: '2', marketAddress: '0x222', totalLongSize: '100', totalShortSize: '50', totalLongCost: '1000', totalShortCost: '500' }
    ];
    
    (activeMarkets.getActiveMarketAddresses as any).mockResolvedValue(new Set(['0x986a383f6de4a24dd3f524f0f93546229b58265f']));
    (subServices.fetchMarkets as any).mockResolvedValue(mockMarkets);
    (subServices.fetchProtocol as any).mockResolvedValue({ totalVolumeUsd: '0' });

    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].marketAddress).toBe('0x986a383f6de4a24dd3f524f0f93546229b58265f');
  });

  it('should return fallback data on subgraph failures', async () => {
    // Advance time by 10 seconds to bypass cache (TTL is 5s)
    const realDateNow = Date.now;
    jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + 10_000);

    (subServices.fetchMarkets as any).mockRejectedValue(new Error('SubGraph Down'));
    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fallback).toBe(true);

    // Restore Date.now
    (Date.now as any).mockRestore();
  });
});
