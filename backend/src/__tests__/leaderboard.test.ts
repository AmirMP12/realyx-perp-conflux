import request from 'supertest';
import { jest } from '@jest/globals';
import { app } from '../app.js';
import * as subServices from '../services/subgraph.js';

jest.mock('../services/subgraph.js');

describe('Leaderboard API Testing', () => {
  it('should fetch top traders', async () => {
    (subServices.fetchLeaderboard as any).mockResolvedValue([
      { address: '0x123', totalRealizedPnl: '5000000000000000000', totalVolumeUsd: '1000000000000000000000', totalTrades: '10' },
      { address: '0x456', totalRealizedPnl: '2500000000000000000', totalVolumeUsd: '500000000000000000000', totalTrades: '5' }
    ]);

    const res = await request(app).get('/api/leaderboard?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].wallet).toBe('0x123');
  });

  it('should handle errors gracefully', async () => {
    (subServices.fetchLeaderboard as any).mockRejectedValue(new Error('Offline'));
    
    const res = await request(app).get('/api/leaderboard?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});
