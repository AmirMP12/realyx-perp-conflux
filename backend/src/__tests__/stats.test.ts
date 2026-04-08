import request from 'supertest';
import { app } from '../app.js';

jest.setTimeout(15000);

describe('Stats API Testing (Integration)', () => {
  it('should return 200 for /api/stats', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
  });

  it('should return 200 for /api/stats/history', async () => {
    const res = await request(app).get('/api/stats/history');
    expect(res.status).toBe(200);
  });
});
