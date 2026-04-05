import request from 'supertest';
import { app } from '../app';

// Mock the backend services to prevent actual blockchain calls during tests
jest.mock('../services/marketData', () => ({
  getMarketData: jest.fn().mockResolvedValue([
    {
      market: '0x0000000000000000000000000000000000000001',
      price: '50000',
      fundingRate: '10',
      openInterest: '1000',
      volume24h: '50000',
      trades24h: 100,
      longInterest: '600',
      shortInterest: '400',
      utilization: 60,
      borrowRate: 5,
      isListed: true
    }
  ])
}));

jest.mock('../services/userProfile', () => ({
  getUserProfile: jest.fn().mockResolvedValue({
    address: '0x1234567890123456789012345678901234567890',
    totalPositions: 5,
    totalVolume: '10000',
    totalFees: '100',
    totalRealizedPnl: '500',
    lastSeenAt: Math.floor(Date.now() / 1000)
  })
}));

describe('API Routes Coverage', () => {
  it('GET /health should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('GET /api/markets should return mock market data', async () => {
    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data[0]).toHaveProperty('market', '0x0000000000000000000000000000000000000001');
  });

  it('GET /api/user/:address should return user profile data', async () => {
    const validAddr = '0x1234567890123456789012345678901234567890';
    const res = await request(app).get(`/api/user/${validAddr}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalPositions', 5);
  });

  it('GET /api/user/:address with invalid address should fail', async () => {
    const res = await request(app).get('/api/user/0xInvalidAddress');
    expect(res.status).toBe(400); // Or whatever error code validation returns
  });

  it('GET /api/something/fake should return 404', async () => {
    const res = await request(app).get('/api/fake_route');
    expect(res.status).toBe(404);
  });
});
