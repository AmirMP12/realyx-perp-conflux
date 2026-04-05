import request from 'supertest';
import { app } from '../app';

describe('Health and Simple Routes Testing', () => {
  it('should hit /health natively and return standard status payload', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.environment).toBeDefined();
    expect(res.body.version).toBeDefined();
  });
});
