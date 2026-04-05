import request from 'supertest';
import { app } from '../app';
import * as subServices from '../services/subgraph';

jest.mock('../services/subgraph');

describe('Leaderboard API Testing', () => {
  it('should fetch top traders mapped globally by realized PnL', async () => {
    (subServices.fetchLeaderboard as jest.Mock).mockResolvedValue([
      { trader: '0x123', realizedPnl: '5000', volume: '100000' },
      { trader: '0x456', realizedPnl: '2500', volume: '50000' }
    ]);

    const res = await request(app).get('/api/leaderboard?limit=10&sortBy=realizedPnl');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].trader).toBe('0x123');
  });

  it('should gracefully limit requests and handle offline nodes', async () => {
    (subServices.fetchLeaderboard as jest.Mock).mockRejectedValue(new Error('Offline'));
    
    const res = await request(app).get('/api/leaderboard?limit=100');
    expect(res.status).toBe(500);
  });
});
