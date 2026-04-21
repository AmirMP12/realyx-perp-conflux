import request from "supertest";
import { app } from "../app.js";
import pg from "pg";
import { ethers } from "ethers";
import * as sync from "../routes/sync.js";

const VALID_ADDR = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";

jest.mock("pg", () => {
    const mPool = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    return { Pool: jest.fn(() => mPool) };
});

const sharedMockProvider = {
    getBlockNumber: jest.fn().mockResolvedValue(1000),
    getLogs: jest.fn().mockResolvedValue([]),
    getNetwork: jest.fn().mockResolvedValue({ chainId: 1030 }),
};

const sharedMockInterface = {
    parseLog: jest.fn().mockReturnValue({ name: "PositionOpened", args: [1, "0xtrader", "0xmarket", true, "1000000000000000000"] }),
};

jest.mock("ethers", () => {
    const mockProvider = jest.fn().mockImplementation(() => sharedMockProvider);
    const mockInterface = jest.fn().mockImplementation(() => sharedMockInterface);

    const mockEthers = {
        JsonRpcProvider: mockProvider,
        Contract: jest.fn().mockImplementation(() => ({})),
        Interface: mockInterface,
        id: jest.fn().mockImplementation((s: string) => "0x" + s.length), // Simple dummy
        ZeroHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    return {
        ...mockEthers,
        ethers: mockEthers,
    };
});

describe("Sync Route Exhaustive Scenarios", () => {
    let pool: any;

    beforeEach(() => {
        const { Pool } = require("pg");
        pool = new Pool();
        jest.clearAllMocks();
        process.env.POSTGRES_URL = "postgres://localhost:5432/test";
        process.env.CRON_SECRET = "test-secret";
        process.env.TRADING_CORE_ADDRESS = VALID_ADDR;
        process.env.RPC_URL = "http://localhost:8545";
        pool.query.mockResolvedValue({ rows: [] });
    });

    it("should fail if POSTGRES_URL is missing", async () => {
        const originalUrl = process.env.POSTGRES_URL;
        delete process.env.POSTGRES_URL;
        // Re-import or trigger pool creation if possible, but here we can just test the exported runSync directly
        // because it calls getPool internally.
        // Wait, getPool uses poolInstance. We need to clear it.
        // For testing purposes, we might need to reset the module state if possible, or just rely on the error thrown in runSync.
        await expect(sync.runSync()).rejects.toThrow("Database not configured");
        process.env.POSTGRES_URL = originalUrl;
    });

    it("should handle error in initDB gracefully", async () => {
        const consoleSpy = jest.spyOn(console, "error").mockImplementation();
        pool.query.mockRejectedValueOnce(new Error("Init failed"));
        
        const res = await request(app)
            .get("/api/sync?key=force")
            .set("Authorization", "Bearer test-secret");
        
        expect(consoleSpy).toHaveBeenCalledWith("Failed to initialize database:", expect.any(Error));
        consoleSpy.mockRestore();
    });

    it("should fail if TRADING_CORE_ADDRESS is missing", async () => {
        const originalAddr = process.env.TRADING_CORE_ADDRESS;
        delete process.env.TRADING_CORE_ADDRESS;
        delete process.env.DEPLOYED_TRADING_CORE;

        const res = await request(app)
            .get("/api/sync?key=force")
            .set("Authorization", "Bearer test-secret");
        
        expect(res.status).toBe(500);
        expect(res.body.error).toContain("TRADING_CORE_ADDRESS or DEPLOYED_TRADING_CORE not set");
        process.env.TRADING_CORE_ADDRESS = originalAddr;
    });

    it("should handle unauthorized cron requests", async () => {
        const res = await request(app).get("/api/sync");
        expect(res.status).toBe(401);
    });

    it("should process PositionClosed and PositionLiquidated events", async () => {
        const mockLogs = [
            { topics: ["0x1"], data: "0x", address: "0xAddr", blockNumber: 100, transactionHash: "0xTx1" },
            { topics: ["0x2"], data: "0x", address: "0xAddr", blockNumber: 101, transactionHash: "0xTx2" },
            { topics: ["0x3"], data: "0x", address: "0xAddr", blockNumber: 102, transactionHash: "0xTx3" },
        ];

        sharedMockProvider.getBlockNumber.mockResolvedValue(1000);
        sharedMockProvider.getLogs.mockResolvedValue(mockLogs);
        
        sharedMockInterface.parseLog
            .mockReturnValueOnce({ name: "PositionOpened", args: [1, "0xtrader", "0xmarket", true, "1000000000000000000"] })
            .mockReturnValueOnce({ name: "PositionClosed", args: [1, "0xtrader", 100, 200, "5000000000000000000"] })
            .mockReturnValueOnce({ name: "PositionLiquidated", args: [1, "0xliq", 150, "10000000000000000000"] });

        // Mock pool.query for lookups
        pool.query.mockImplementation((sql: string) => {
            if (sql.includes("account") && sql.includes("market_id") && sql.includes("PositionOpened")) {
                return Promise.resolve({ rows: [{ account: "0xtraderresolved", market_id: "0xmarketresolved" }] });
            }
            if (sql.includes("market_id") && sql.includes("PositionOpened")) {
                return Promise.resolve({ rows: [{ market_id: "0xmarketresolved" }] });
            }
            return Promise.resolve({ rows: [] });
        });

        const result = await sync.runSync({ fromBlock: 0 });
        expect(result.eventsSynced).toBe(3);
        const insertCalls = pool.query.mock.calls.filter((c: any) => c[0].includes("INSERT INTO position_events"));
        expect(insertCalls).toHaveLength(3);
        
        // Call 1: PositionOpened
        expect(insertCalls[0][1]).toContain("0xtrader");
        expect(insertCalls[0][1]).toContain("PositionOpened");
        
        // Call 2: PositionClosed (Resolved)
        expect(insertCalls[1][1]).toContain("0xtraderresolved");
        expect(insertCalls[1][1]).toContain("PositionClosed");

        // Call 3: PositionLiquidated (Resolved)
        expect(insertCalls[2][1]).toContain("0xtraderresolved");
        expect(insertCalls[2][1]).toContain("PositionLiquidated");
    });

    it("should handle parseLog returning null", async () => {
        sharedMockProvider.getLogs.mockResolvedValue([{ topics: ["0x1"], data: "0x" }]);
        sharedMockInterface.parseLog.mockReturnValue(null);

        const result = await sync.runSync({ fromBlock: 0 });
        expect(result.eventsSynced).toBe(0);
    });

    it("should handle error during processLogs locally", async () => {
        sharedMockProvider.getLogs.mockResolvedValue([{ topics: ["0x1"], data: "0x" }]);
        sharedMockInterface.parseLog.mockImplementation(() => { throw new Error("Parse boom"); });
        const consoleSpy = jest.spyOn(console, "error").mockImplementation();

        const result = await sync.runSync({ fromBlock: 0 });
        expect(result.eventsSynced).toBe(0);
        expect(consoleSpy).toHaveBeenCalledWith("Parse error", expect.any(Error));
        consoleSpy.mockRestore();
    });

    it("should support fromBlock from query", async () => {
        sharedMockProvider.getBlockNumber.mockResolvedValue(2000);
        sharedMockProvider.getLogs.mockResolvedValue([]);
        
        const res = await request(app)
            .get("/api/sync?key=force&fromBlock=1500")
            .set("Authorization", "Bearer test-secret");
        
        expect(res.status).toBe(200);
        // It should scan from 1500 to 2000
        expect(res.body.scannedFrom).toBe(1500);
    });

    it("should cover checkAndSync logic (stale data)", async () => {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        // Last sync 1 hour ago
        const staleDate = new Date(Date.now() - 3600000).toISOString();
        pool.query.mockResolvedValueOnce({ rows: [{ last_synced_at: staleDate }] });
        
        await sync.checkAndSync();
        
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Data is stale"));
        consoleSpy.mockRestore();
    });

    it("should cover checkAndSync logic (fresh data)", async () => {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        // Last sync 10 seconds ago
        const freshDate = new Date(Date.now() - 10000).toISOString();
        pool.query.mockResolvedValueOnce({ rows: [{ last_synced_at: freshDate }] });
        
        await sync.checkAndSync();
        
        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("Data is stale"));
        consoleSpy.mockRestore();
    });

    it("should cover checkAndSync query error", async () => {
        const consoleSpy = jest.spyOn(console, "error").mockImplementation();
        pool.query.mockRejectedValueOnce(new Error("DB Down"));
        
        await sync.checkAndSync();
        
        expect(consoleSpy).toHaveBeenCalledWith("[lazy-sync] check failure:", expect.any(Error));
        consoleSpy.mockRestore();
    });
});
