import request from 'supertest';
import { app } from '../app.js';
import * as indexer from '../services/indexer.js';
import * as pyth from '../services/pyth.js';

jest.mock('../services/indexer.js', () => ({
    fetchProtocol: jest.fn().mockResolvedValue({ totalVolumeUsd: "5000" }),
}));

jest.mock('../services/pyth.js', () => ({
    fetchPythPrices: jest.fn().mockResolvedValue({ "BTC-USD": 60000 }),
}));

jest.mock('../services/activeMarkets.js', () => ({
    getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('ethers', () => ({
    JsonRpcProvider: jest.fn(() => ({
        getNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
    })),
    Contract: jest.fn(() => ({
        totalAssets: jest.fn().mockResolvedValue(1000n * 10n**12n),
    })),
}));

describe('Health Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 200 for basic health check', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('should return 200 for detailed health if everything is ok', async () => {
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.checks.indexer.ok).toBe(true);
        expect(res.body.checks.pyth.ok).toBe(true);
        expect(res.body.checks.rpc.ok).toBe(true);
    }, 15000);

    it('should return 503 if one check fails', async () => {
        (indexer.fetchProtocol as jest.Mock).mockRejectedValueOnce(new Error("Indexer Fail"));
        
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.ok).toBe(false);
        expect(res.body.checks.indexer.ok).toBe(false);
        expect(res.body.checks.indexer.error).toBe("Indexer Fail");
    });

    it('should handle Pyth failure in detailed health', async () => {
        (pyth.fetchPythPrices as jest.Mock).mockRejectedValueOnce(new Error("Pyth Fail"));
        
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.checks.pyth.ok).toBe(false);
    });
});
