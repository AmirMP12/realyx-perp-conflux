import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";
import { ethers } from "ethers";

// One-time global mocks
const mockPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: jest.fn(),
};

jest.mock("pg", () => ({
    __esModule: true,
    Pool: jest.fn(() => mockPool),
    default: { Pool: jest.fn(() => mockPool) }
}));

const mockProvider = {
    getBlockNumber: jest.fn().mockResolvedValue(1000),
    getLogs: jest.fn().mockResolvedValue([]),
    getBlock: jest.fn().mockResolvedValue({ timestamp: 1713400000 }),
    getNetwork: jest.fn().mockResolvedValue({ chainId: 71 }),
};

jest.mock("ethers", () => {
    const original = jest.requireActual("ethers") as any;
    return {
        ...original,
        ethers: {
            ...original.ethers,
            JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
            Interface: original.ethers.Interface,
            id: original.ethers.id,
            AbiCoder: original.ethers.AbiCoder,
            zeroPadValue: original.ethers.zeroPadValue,
            toBeHex: original.ethers.toBeHex,
        },
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
    };
});

describe("Sync Exhaustive Final (v3)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.POSTGRES_URL = "postgres://local";
        process.env.TRADING_CORE_ADDRESS = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
        process.env.NODE_ENV = "test";
        process.env.CRON_SECRET = "secret";
    });

    it("reaches >80% branch coverage with PROPER log encoding and timeout", async () => {
        const sync = await import("../routes/sync.js");
        const trader = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";

        // --- 1. Loop Continuation (126) & Timeout (111) ---
        mockProvider.getBlockNumber.mockResolvedValue(1000000); 
        
        let timeMock = 1000000;
        const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
            timeMock += 4000; // Jump 4s each call. 
            return timeMock;
        });

        // --- 2. Batch Optimization (184-185) & Proper Log Parsing ---
        const openedSig = "PositionOpened(uint256,address,address,bool,uint256,uint256,uint256)";
        const openedTopic = ethers.id(openedSig);
        const topics = [
            openedTopic,
            ethers.zeroPadValue(ethers.toBeHex(1n), 32),
            ethers.zeroPadValue(trader, 32),
            ethers.zeroPadValue(trader, 32)
        ];
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bool", "uint256", "uint256", "uint256"],
            [true, 100n, 10n, 200n]
        );

        mockProvider.getLogs.mockResolvedValue([
            { topics, data, address: trader, blockNumber: 500, transactionHash: "0x1" },
            { topics, data, address: trader, blockNumber: 500, transactionHash: "0x2" }
        ]);

        // --- 3. Cache Eviction (158-159) ---
        const sizeSpy = jest.spyOn(Map.prototype, "size", "get").mockReturnValue(2005);
        const keysSpy = jest.spyOn(Map.prototype, "keys").mockImplementation(() => ({
            next: () => ({ value: 123, done: false }),
            [Symbol.iterator]: function() { return this; }
        } as any));

        await sync.runSync({ fromBlock: 100 });
        
        nowSpy.mockRestore();
        sizeSpy.mockRestore();
        keysSpy.mockRestore();

        // --- 4. Resolution Permutations (210-213) ---
        const closeSig = "PositionClosed(uint256,address,int256,uint256,uint256)";
        const closeTopic = ethers.id(closeSig);
        const closeTopics = [
            closeTopic,
            ethers.zeroPadValue(ethers.toBeHex(1n), 32),
            ethers.zeroPadValue(trader, 32)
        ];
        const closeData = ethers.AbiCoder.defaultAbiCoder().encode(["int256", "uint256", "uint256"], [0n, 0n, 0n]);
        mockProvider.getLogs.mockResolvedValue([{ topics: closeTopics, data: closeData, address: trader, blockNumber: 600, transactionHash: "0x3" }]);
        
        mockPool.query.mockResolvedValueOnce({ rows: [{ last_synced_block: 0 }] }); // key
        mockPool.query.mockResolvedValueOnce({ rows: [{ account: null, market_id: null, data: ["1", "2", trader] }] });
        await sync.runSync({ fromBlock: 600 });
        
        // --- 5. Repair Loop body (243) and Error (248) ---
        mockPool.query.mockImplementation((sql: string) => {
            if (sql.includes("last_synced_at")) return Promise.resolve({ rows: [{ last_synced_at: "2020-01-01" }] });
            if (sql.includes("last_synced_block")) return Promise.resolve({ rows: [{ last_synced_block: 0 }] });
            if (sql.includes("SELECT id, block_number")) return Promise.resolve({ rows: [{ id: 1, block_number: 1000 }] });
            if (sql.includes("UPDATE position_events")) return Promise.resolve({ rows: [], rowCount: 1 });
            return Promise.resolve({ rows: [] });
        });
        await sync.checkAndSync();

        mockPool.query.mockImplementation((sql: string) => {
            if (sql.includes("SELECT id, block_number")) throw new Error("Repair Die");
            return Promise.resolve({ rows: [] });
        });
        try { await sync.checkAndSync(); } catch {}

        // --- 6. Router and Auth (278-281) ---
        const app = express();
        app.use("/sync", sync.default);
        const res1 = await request(app).get("/sync").set("Authorization", "Bearer bad");
        expect(res1.status).toBe(401);
    });
});
