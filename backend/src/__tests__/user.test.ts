import request from 'supertest';
import { jest } from '@jest/globals';
import { app } from '../app.js';
import * as subgraph from '../services/indexer.js';

jest.mock('../services/indexer.js');

describe('User Tracking REST API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should return user positions', async () => {
    const validAddr = '0x1111111111111111111111111111111111111111';
    
    (subgraph.fetchUserPositions as any).mockResolvedValue([
      {
        id: '1',
        market: { id: 'm1', marketAddress: '0xabc' },
        isLong: true,
        size: '1000000000000000000',
        entryPrice: '50000000000000000000000',
        collateralAmount: '1000000000000000000000',
        leverage: '10',
        liquidationPrice: '45000000000000000000000',
        openTimestamp: '1600000000'
      }
    ]);

    const res = await request(app).get(`/api/user/${validAddr}/positions`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].side).toBe('LONG');
  });

  it('should handle errors gracefully', async () => {
    const validAddr = '0x2222222222222222222222222222222222222222';
    
    (subgraph.fetchUserPositions as any).mockRejectedValue(new Error('SubGraph error'));

    const res = await request(app).get(`/api/user/${validAddr}/positions`);
    
    expect(res.status).toBe(200); // Many routes here catch and return success: false
    expect(res.body.success).toBe(false);
  });
});
