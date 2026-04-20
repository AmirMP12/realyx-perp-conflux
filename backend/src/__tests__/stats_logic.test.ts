import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

const mIndexer = {
    fetchProtocol: jest.fn().mockResolvedValue({ totalVolumeUsd: "1000", totalLiquidations: "5" }),
    fetchMarkets: jest.fn().mockResolvedValue([]),
    fetchActiveTraders24h: jest.fn().mockResolvedValue(5),
    fetchProtocolMetrics: jest.fn().mockResolvedValue([]),
};

const mActiveMarkets = {
    getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set()),
};

jest.doMock("../services/indexer.js", () => mIndexer);
jest.doMock("../services/activeMarkets.js", () => mActiveMarkets);
jest.doMock("ethers", () => ({
    ethers: {
        JsonRpcProvider: jest.fn(() => ({
            getNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
        })),
        Contract: jest.fn(() => ({
            totalAssets: jest.fn().mockResolvedValue(1000n * 10n**12n),
        })),
    }
}));

describe("Stats Route Logic Paths", () => {
    let app: express.Express;

    beforeEach(async () => {
        jest.clearAllMocks();
        process.env.TVL_CACHE_MS = "30000";
        
        // Use default values for mIndexer
        mIndexer.fetchProtocol.mockResolvedValue({ totalVolumeUsd: "1000", totalLiquidations: "5" });
        mIndexer.fetchMarkets.mockResolvedValue([]);
        mActiveMarkets.getActiveMarketAddresses.mockResolvedValue(new Set());

        const statsRouter = (await import("../routes/stats.js")).default;
        app = express();
        app.use("/api/stats", statsRouter);
    });

    it("hits volume fallback sum (70-71)", async () => {
        mIndexer.fetchProtocol.mockResolvedValue({ totalVolumeUsd: "0", totalLiquidations: "0" });
        mIndexer.fetchMarkets.mockResolvedValue([
            { marketAddress: "0x1", volume24h: "123.45", totalLongSize: "0", totalShortSize: "0" }
        ]);
        
        const res = await request(app).get("/api/stats");
        expect(res.body.data.volume24h).toBe("123.450000");
    });

    it("hits TVL cache branches (22-23)", async () => {
        // First call to set cache
        await request(app).get("/api/stats");
        
        // Second call should hit cache if time hasn't passed
        const res = await request(app).get("/api/stats");
        expect(res.status).toBe(200);
    });

    it("handles error in /history", async () => {
        mIndexer.fetchProtocolMetrics.mockRejectedValueOnce(new Error("History Fail"));
        const res = await request(app).get("/api/stats/history");
        expect(res.body.success).toBe(false);
    });
});
