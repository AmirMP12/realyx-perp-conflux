import request from "supertest";
import { app } from "../app.js";
import pg from "pg";
import * as indexer from "../services/indexer.js";

jest.mock("pg", () => {
    const mPool = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    return { Pool: jest.fn(() => mPool) };
});

jest.mock("../services/indexer.js", () => ({
    fetchProtocol: jest.fn().mockResolvedValue({ totalVolumeUsd: "1000", totalLiquidations: "5" }),
    fetchMarkets: jest.fn().mockResolvedValue([]),
    fetchProtocolMetrics: jest.fn().mockResolvedValue([{ timestamp: "1713400000", volumeUsd: "1000000000000000000", tradesCount: "10", feesUsd: "100000000000000000" }]),
    fetchActiveTraders24h: jest.fn().mockResolvedValue(5),
}));

jest.mock("../services/activeMarkets.js", () => ({
    getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock("ethers", () => ({
    JsonRpcProvider: jest.fn(() => ({
        getNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
    })),
    Contract: jest.fn(() => ({
        totalAssets: jest.fn().mockResolvedValue(1000n * 10n**12n),
    })),
}));

describe("Stats Routes", () => {
    let pool: any;

    beforeEach(() => {
        const { Pool } = require("pg");
        pool = new Pool();
        jest.clearAllMocks();
    });

    it("GET /api/stats should return protocol stats", async () => {
        const res = await request(app).get("/api/stats");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.volume24h).toBe("1000.000000");
    }, 15000);

    it("GET /api/stats should handle errors", async () => {
        (indexer.fetchProtocol as jest.Mock).mockRejectedValueOnce(new Error("Indexer Fail"));
        const res = await request(app).get("/api/stats");
        expect(res.status).toBe(200); // Route catches error and returns success:false with default data
        expect(res.body.success).toBe(false);
    });

    it("GET /api/stats/history should return history data", async () => {
        const res = await request(app).get("/api/stats/history");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
    });

    it("GET /api/stats/history should handle errors", async () => {
        (indexer.fetchProtocolMetrics as jest.Mock).mockRejectedValueOnce(new Error("Meta Fail"));
        const res = await request(app).get("/api/stats/history");
        expect(res.body.success).toBe(false);
    });
});
