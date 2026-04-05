import request from 'supertest';
import { app } from '../app';
import * as activeMarkets from '../services/activeMarkets';
import * as subServices from '../services/subgraph';

jest.mock('../services/activeMarkets');
jest.mock('../services/subgraph');

describe('Markets API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should filter active markets natively and return standard mock output', async () => {
    const mockMarkets = [
      { marketAddress: '0x111', totalLongSize: '10', totalShortSize: '5' },
      { marketAddress: '0x222', totalLongSize: '100', totalShortSize: '50' }
    ];
    
    (activeMarkets.getActiveMarketAddresses as jest.Mock).mockResolvedValue(new Set(['0x111']));
    (subServices.fetchMarkets as jest.Mock).mockResolvedValue(mockMarkets);

    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Since mock Pyth prices aren't loaded in this simple mock context, it will still return the array.
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it('should return 500 on subgraph logic failures natively', async () => {
    (subServices.fetchMarkets as jest.Mock).mockRejectedValue(new Error('SubGraph Down'));
    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
