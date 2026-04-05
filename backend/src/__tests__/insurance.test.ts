import request from 'supertest';
import { app } from '../app';
import * as subServices from '../services/subgraph';

jest.mock('../services/subgraph');

describe('Insurance REST API', () => {
  it('should fetch the vault and insurance state actively', async () => {
    (subServices.fetchVaultInfo as jest.Mock).mockResolvedValue({
      totalAssets: '1500000',
      totalShares: '1000000'
    });
    
    (subServices.fetchProtocol as jest.Mock).mockResolvedValue({
      insuranceFundBalanceUsd: '50000'
    });

    const res = await request(app).get('/api/insurance');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.insuranceFundBalanceUsd).toBe('50000');
    expect(res.body.data.vaultAssets).toBe('1500000');
  });

  it('should fallback gracefully when subgraphs are offline natively', async () => {
    (subServices.fetchVaultInfo as jest.Mock).mockRejectedValue(new Error('Down'));
    
    const res = await request(app).get('/api/insurance');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
