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

jest.mock("ethers", () => {
    const mockProvider = jest.fn().mockImplementation(() => ({
        getBlockNumber: jest.fn().mockResolvedValue(1000),
        getLogs: jest.fn().mockResolvedValue([]),
        getNetwork: jest.fn().mockResolvedValue({ chainId: 1030 }),
    }));
    const mockInterface = jest.fn().mockImplementation(() => ({
        parseLog: jest.fn().mockReturnValue({ name: "PositionOpened", args: [1, "0xTrader", "0xMarket"] }),
    }));

    const mockEthers = {
        JsonRpcProvider: mockProvider,
        Contract: jest.fn().mockImplementation(() => ({})),
        Interface: mockInterface,
        id: jest.fn().mockReturnValue("0xTopic"),
        ZeroHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    return {
        ...mockEthers,
        ethers: mockEthers,
    };
});

describe("Sync Route Extended Scenarios", () => {
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

    it("should allow force key bypass", async () => {
        const res = await request(app).get("/api/sync?key=force");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    }, 15000);

    it("should handle already up to date", async () => {
        pool.query.mockImplementation((sql: string) => {
            if (sql.includes("SELECT last_synced_block")) {
                return Promise.resolve({ rows: [{ last_synced_block: 2000 }] });
            }
            return Promise.resolve({ rows: [] });
        });
        const result = await sync.runSync();
        expect(result.message).toBe("Already up to date");
    }, 15000);
});
