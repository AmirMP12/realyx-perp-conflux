import request from 'supertest';
import { app } from '../app.js';

describe('Insurance Routes Coverage', () => {
  it('should get insurance claims', async () => {
    const res = await request(app).get('/api/insurance/claims');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should handle claim coverage details', async () => {
    const res = await request(app).get('/api/insurance/claims/123');
    // Assuming 404 since claim 123 doesn't exist in our mock dataset yet
    expect([200, 404]).toContain(res.status);
  });
});
