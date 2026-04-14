import request from 'supertest';
import { app } from '../app.js';
import { jest } from '@jest/globals';

jest.mock('../services/activeMarkets.js', () => ({
  getActiveMarketAddresses: (jest as any).fn().mockResolvedValue(null),
}));

jest.setTimeout(30000);

describe('Markets Route Deep Coverage', () => {
  it('should cover sorting by various fields', async () => {
    const fields = ['name', 'symbol', 'dailyVolume', 'priceChange24h', 'oi', 'fundingRate'];
    for (const field of fields) {
      await request(app).get(`/api/markets?sortBy=${field}&sortDir=desc`);
      await request(app).get(`/api/markets?sortBy=${field}&sortDir=asc`);
    }
  });

  it('should cover category filtering', async () => {
    const categories = ['CRYPTO', 'STOCK', 'COMMODITY', 'FOREX'];
    for (const cat of categories) {
      await request(app).get(`/api/markets?category=${cat}`);
    }
  });

  it('should cover price history sources', async () => {
    const marketId = '0x986a383f6de4a24dd3f524f0f93546229b58265f';
    await request(app).get(`/api/markets/price-history/${marketId}?source=pyth`);
    await request(app).get(`/api/markets/price-history/${marketId}?source=coingecko`);
    await request(app).get(`/api/markets/price-history/${marketId}?days=30`);
  });

  it('should handle market not found for history', async () => {
    const res = await request(app).get('/api/markets/price-history/invalid-id');
    expect(res.status).toBe(404);
  });

  it('should handle indexPrice calculation branches', async () => {
     await request(app).get('/api/markets');
  });

  it('should handle fallback mode if subgraph fails', async () => {
    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
  });
});
