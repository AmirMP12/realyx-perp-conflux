import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

describe('Health Route Logic Paths', () => {
    let app: express.Express;
    let indexer: any;
    let pyth: any;
    let activeMarkets: any;

    beforeEach(async () => {
        jest.resetModules();
        
        // Mock dependencies
        jest.doMock('../services/indexer.js', () => ({
            fetchProtocol: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../services/pyth.js', () => ({
            fetchPythPrices: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../services/activeMarkets.js', () => ({
            getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set()),
        }));

        indexer = await import('../services/indexer.js');
        pyth = await import('../services/pyth.js');
        activeMarkets = await import('../services/activeMarkets.js');

        const healthRouter = (await import('../routes/health.js')).default;
        app = express();
        app.use('/health', healthRouter);
    });

    it('hits rpc failure branch', async () => {
        activeMarkets.getActiveMarketAddresses.mockRejectedValueOnce(new Error("RPC Fail"));
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.checks.rpc.ok).toBe(false);
    });

    it('hits pyth failure branch', async () => {
        pyth.fetchPythPrices.mockRejectedValueOnce(new Error("Pyth Fail"));
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.checks.pyth.ok).toBe(false);
    });

    it('hits indexer failure branch', async () => {
        indexer.fetchProtocol.mockRejectedValueOnce(new Error("Indexer Fail"));
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.checks.indexer.ok).toBe(false);
    });

    it('hits null activeMarkets branch (40)', async () => {
        activeMarkets.getActiveMarketAddresses.mockResolvedValueOnce(null);
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(200);
        expect(res.body.checks.rpc.activeMarkets).toBe(null);
    });

    it('hits empty prices branch', async () => {
        pyth.fetchPythPrices.mockResolvedValueOnce(null);
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(200);
    });

    it('hits all success branch and config branches', async () => {
        delete process.env.RPC_URL;
        delete process.env.TRADING_CORE_ADDRESS;
        delete process.env.DEPLOYED_TRADING_CORE;
        
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.config.rpcSet).toBe(false);
        expect(res.body.config.tradingCoreSet).toBe(false);
    });
});
