import request from 'supertest';
import { app } from '../app';
import * as userServices from '../services/userProfile';

jest.mock('../services/userProfile');

describe('User Tracking REST API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should accurately return a fully mocked user stat profile', async () => {
    const validAddr = '0x1111111111111111111111111111111111111111';
    
    (userServices.getUserProfile as jest.Mock).mockResolvedValue({
      address: validAddr,
      totalPositions: 15,
      totalVolume: '250000',
      totalFees: '400',
      totalRealizedPnl: '-1000',
      lastSeenAt: 1234567890
    });

    const res = await request(app).get(`/api/user/${validAddr}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalPositions).toBe(15);
    expect(res.body.data.totalVolume).toBe('250000');
    expect(res.body.data.totalRealizedPnl).toBe('-1000');
  });

  it('should catch internally dropped user routines natively', async () => {
    const validAddr = '0x2222222222222222222222222222222222222222';
    
    (userServices.getUserProfile as jest.Mock).mockRejectedValue(new Error('SubGraph Rate Limit'));

    const res = await request(app).get(`/api/user/${validAddr}`);
    
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
