import { jest } from "@jest/globals";

describe("Indexer Logic Paths", () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.POSTGRES_URL = "postgres://localhost:5432/test";
        process.env.NODE_ENV = "test";
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("getPool: returns null if POSTGRES_URL is missing", async () => {
        delete process.env.POSTGRES_URL;
        const indexer = await import("../services/indexer.js");
        expect(await indexer.fetchActiveTraders24h()).toBe(0);
    });

    it("getPool: initializes pool with SSL in production", async () => {
        process.env.NODE_ENV = "production";
        process.env.POSTGRES_URL = "postgres://u:p@h:5/d";
        
        const localPoolMock = jest.fn(() => ({
            query: jest.fn().mockResolvedValue({ rows: [] }),
            on: jest.fn(),
        }));
        jest.doMock("pg", () => ({
            __esModule: true,
            Pool: localPoolMock,
            default: { Pool: localPoolMock }
        }));
        
        const indexer = await import("../services/indexer.js");
        await indexer.fetchActiveTraders24h();
        
        expect(localPoolMock).toHaveBeenCalledWith(expect.objectContaining({
            ssl: { rejectUnauthorized: false }
        }));
    });

    it("fetchProtocol: returns test data in test env if PG URL missing", async () => {
        delete process.env.POSTGRES_URL;
        process.env.NODE_ENV = "test";
        const indexer = await import("../services/indexer.js");
        const res = await indexer.fetchProtocol();
        expect(res?.totalVolumeUsd).toBe("50000");
    });

    it("fetchProtocol: handles volume query failure", async () => {
        const mPool = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [{ event_type: "PositionOpened", count: "10" }] })
                .mockRejectedValueOnce(new Error("Query Fail")),
            on: jest.fn(),
        };
        jest.doMock("pg", () => ({
            __esModule: true,
            Pool: jest.fn(() => mPool),
            default: { Pool: jest.fn(() => mPool) }
        }));

        const indexer = await import("../services/indexer.js");
        const res = await indexer.fetchProtocol();
        expect(res).toBeNull();
    });

    it("fetchActiveTraders24h: handles string n return", async () => {
        const mPool = {
            query: jest.fn().mockResolvedValueOnce({ rows: [{ n: "42" }] }),
            on: jest.fn(),
        };
        jest.doMock("pg", () => ({
            __esModule: true,
            Pool: jest.fn(() => mPool),
            default: { Pool: jest.fn(() => mPool) }
        }));
        const indexer = await import("../services/indexer.js");
        expect(await indexer.fetchActiveTraders24h()).toBe(42);
    });

    it("fetchMarkets: handles db error gracefully", async () => {
        jest.doMock("../services/fetchMarketsOnchain.js", () => ({
            fetchMarketsOnChain: jest.fn().mockResolvedValue([{ marketAddress: "0x1" }])
        }));
        const mPool = {
            query: jest.fn().mockRejectedValueOnce(new Error("DB Down")),
            on: jest.fn(),
        };
        jest.doMock("pg", () => ({
            __esModule: true,
            Pool: jest.fn(() => mPool),
            default: { Pool: jest.fn(() => mPool) }
        }));
        const indexer = await import("../services/indexer.js");
        const res = await indexer.fetchMarkets();
        expect(res.length).toBeGreaterThan(1);
    });

    it("fetchLeaderboard: dummy data in non-production", async () => {
        process.env.NODE_ENV = "development";
        const mPool = {
            query: jest.fn().mockRejectedValueOnce(new Error("LB Fail")),
            on: jest.fn(),
        };
        jest.doMock("pg", () => ({
            __esModule: true,
            Pool: jest.fn(() => mPool),
            default: { Pool: jest.fn(() => mPool) }
        }));
        const indexer = await import("../services/indexer.js");
        const res = await indexer.fetchLeaderboard(10);
        expect(res).toHaveLength(3);
    });

    it("fetchUserPositions: handles malformed data", async () => {
        const mPool = {
            query: jest.fn().mockResolvedValueOnce({ rows: [{ data: "{bad", market_id: "0x1", id: "1", created_at: new Date().toISOString() }] }),
            on: jest.fn(),
        };
        jest.doMock("pg", () => ({
            __esModule: true,
            Pool: jest.fn(() => mPool),
            default: { Pool: jest.fn(() => mPool) }
        }));
        const indexer = await import("../services/indexer.js");
        const res = await indexer.fetchUserPositions("0x123");
        expect(res).toHaveLength(1);
    });
});
