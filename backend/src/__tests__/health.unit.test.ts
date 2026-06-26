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

    it('returns 503 when the active-markets RPC check fails', async () => {
        activeMarkets.getActiveMarketAddresses.mockRejectedValueOnce(new Error("RPC Fail"));
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.checks.rpc.ok).toBe(false);
    });

    it('returns 503 when the pyth price check fails', async () => {
        pyth.fetchPythPrices.mockRejectedValueOnce(new Error("Pyth Fail"));
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.checks.pyth.ok).toBe(false);
    });

    it('returns 503 when the indexer check fails', async () => {
        indexer.fetchProtocol.mockRejectedValueOnce(new Error("Indexer Fail"));
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(503);
        expect(res.body.checks.indexer.ok).toBe(false);
    });

    it('reports null active markets when the filter returns null', async () => {
        activeMarkets.getActiveMarketAddresses.mockResolvedValueOnce(null);
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(200);
        expect(res.body.checks.rpc.activeMarkets).toBe(null);
    });

    it('returns 200 when pyth returns no prices', async () => {
        pyth.fetchPythPrices.mockResolvedValueOnce(null);
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(200);
    });

    it('reports config flags as false when RPC and trading core env are unset', async () => {
        delete process.env.RPC_URL;
        delete process.env.TRADING_CORE_ADDRESS;
        delete process.env.DEPLOYED_TRADING_CORE;
        
        const res = await request(app).get('/health/detailed');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.config.rpcSet).toBe(false);
        expect(res.body.config.tradingCoreSet).toBe(false);
    });

    it('reports vaultCore and referralRegistry config flags', async () => {
        const prevVault = process.env.VAULT_CORE_ADDRESS;
        const prevRef = process.env.REFERRAL_REGISTRY_ADDRESS;
        process.env.VAULT_CORE_ADDRESS = '0x98E011A8782aF36C5Ad6051bC54B86a7c0705F67';
        delete process.env.DEPLOYED_REFERRAL_REGISTRY;
        delete process.env.REFERRAL_REGISTRY_ADDRESS;

        const res = await request(app).get('/health/detailed');
        expect(res.body.config.vaultCoreSet).toBe(true);
        expect(res.body.config.referralRegistrySet).toBe(false);

        if (prevVault === undefined) delete process.env.VAULT_CORE_ADDRESS;
        else process.env.VAULT_CORE_ADDRESS = prevVault;
        if (prevRef !== undefined) process.env.REFERRAL_REGISTRY_ADDRESS = prevRef;
    });
});
