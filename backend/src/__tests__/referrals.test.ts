import request from 'supertest';
import { app } from '../app.js';

describe('Referrals Routes', () => {
  const VALID = '0xabcdef0000000000000000000000000000000001';
  const prevRegistry = process.env.REFERRAL_REGISTRY_ADDRESS;
  const prevDeployed = process.env.DEPLOYED_REFERRAL_REGISTRY;

  afterEach(() => {
    if (prevRegistry === undefined) delete process.env.REFERRAL_REGISTRY_ADDRESS;
    else process.env.REFERRAL_REGISTRY_ADDRESS = prevRegistry;
    if (prevDeployed === undefined) delete process.env.DEPLOYED_REFERRAL_REGISTRY;
    else process.env.DEPLOYED_REFERRAL_REGISTRY = prevDeployed;
  });

  it('rejects a missing/invalid address with 400', async () => {
    const res = await request(app).get('/api/referrals/stats');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a malformed address with 400', async () => {
    const res = await request(app).get('/api/referrals/stats?address=not-an-address');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('reports the program as not-live when no registry is configured', async () => {
    delete process.env.REFERRAL_REGISTRY_ADDRESS;
    delete process.env.DEPLOYED_REFERRAL_REGISTRY;
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      live: false,
      referees: 0,
      totalEarned: '0',
      pendingClaim: '0',
    });
  });

  it('is also mounted under /api/v1', async () => {
    delete process.env.REFERRAL_REGISTRY_ADDRESS;
    delete process.env.DEPLOYED_REFERRAL_REGISTRY;
    const res = await request(app).get(`/api/v1/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
