import request from 'supertest';
import { app } from '../app';
import * as subServices from '../services/subgraph';

jest.mock('../services/subgraph');

describe('Stats API Testing', () => {
  it('should fetch protocol overview statistics successfully', async () => {
    (subServices.fetchProtocol as jest.Mock).mockResolvedValue({
      totalVolumeUsd: '5000000',
      totalFeesUsd: '20000',
      totalTrades: '150'
    });

    const res = await request(app).get('/api/stats/overview');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalVolumeUsd).toBe('5000000');
  });

  it('should fallback gracefully when fetching protocol overview fails', async () => {
    (subServices.fetchProtocol as jest.Mock).mockRejectedValue(new Error('SubGraph Failed'));
    
    const res = await request(app).get('/api/stats/overview');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
