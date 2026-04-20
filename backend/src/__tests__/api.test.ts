import request from 'supertest';
import { jest } from '@jest/globals';
import { app } from '../app.js';

jest.mock('../services/indexer.js', () => ({
  fetchMarkets: jest.fn().mockResolvedValue([]),
  fetchProtocol: jest.fn().mockResolvedValue({}),
  fetchUserPositions: jest.fn().mockResolvedValue([]),
  fetchProtocolMetrics: jest.fn().mockResolvedValue([]),
  fetchUserTradeHistory: jest.fn().mockResolvedValue([]),
}));

describe('API Routes Coverage', () => {
  it('GET /health should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/user/0x123/positions should return positions', async () => {
    const res = await request(app).get('/api/user/0x123/positions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
