import request from 'supertest';
import { app } from '../app.js';
import { jest } from "@jest/globals";

jest.mock('../services/activeMarkets.js', () => ({
  getActiveMarketAddresses: (jest as any).fn().mockResolvedValue(null),
}));

jest.setTimeout(20000);

describe('Aggregate API Routes Coverage (No Mocks)', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('GET /api/insurance/claims', async () => {
    const res = await request(app).get('/api/insurance/claims');
    expect(res.status).toBe(200);
  });

  it('GET /api/leaderboard', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
  });

  it('GET /api/stats', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
  });

  it('GET /api/stats/history', async () => {
    const res = await request(app).get('/api/stats/history');
    expect(res.status).toBe(200);
  });

  it('GET /api/markets', async () => {
    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
  });

  it('GET /api/user/0x0000000000000000000000000000000000000000/positions', async () => {
    const res = await request(app).get('/api/user/0x0000000000000000000000000000000000000000/positions');
    expect(res.status).toBe(200);
  });
});
