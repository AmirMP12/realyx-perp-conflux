import { jest } from "@jest/globals";

// 1. Mocks at the very top
jest.mock("fs", () => ({
  default: { existsSync: jest.fn().mockReturnValue(false) },
  existsSync: jest.fn().mockReturnValue(false),
}));

jest.mock("ethers", () => ({
  __esModule: true,
  ethers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getBlockNumber: jest.fn().mockResolvedValue(100),
      getLogs: jest.fn().mockResolvedValue([]),
    })),
    Contract: jest.fn().mockImplementation(() => ({
      totalAssets: jest.fn().mockResolvedValue(1000n),
    })),
    Interface: jest.fn().mockImplementation(() => ({
      parseLog: jest.fn().mockReturnValue({ name: "PositionOpened", args: ["1", "0xTrader", "0xMarket", true, "100", "10", "500"] }),
    })),
    id: jest.fn().mockReturnValue("0xtopic"),
    ZeroAddress: "0x0",
  }
}));

const mockGetActive = jest.fn().mockResolvedValue(new Set(["0xm1"]));
jest.mock("../services/activeMarkets.js", () => ({
  getActiveMarketAddresses: mockGetActive
}));

jest.mock("../app.js", () => ({
  app: {
    listen: jest.fn().mockImplementation((p, cb: any) => { if (cb) cb(); return { close: jest.fn() }; }),
  },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../wsServer.js", () => ({ startWsServer: jest.fn() }));

const mockPoolQuery = jest.fn();
jest.mock("pg", () => ({
  __esModule: true,
  Pool: jest.fn(() => ({
    query: mockPoolQuery,
    on: jest.fn(),
    end: jest.fn(),
  })),
  default: {
    Pool: jest.fn(() => ({
      query: mockPoolQuery,
      on: jest.fn(),
      end: jest.fn(),
    })),
  }
}));

// 2. Imports
import * as indexer from "../services/indexer.js";
import * as sync from "../routes/sync.js";
import * as onchain from "../services/fetchMarketsOnchain.js";
import request from "supertest";
import express from "express";

describe("Comprehensive System Logic Paths", () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.POSTGRES_URL = "postgres://test";
        process.env.TRADING_CORE_ADDRESS = "0xBTC";
    });

    describe("Sync Service & Route Branches", () => {
        it("exercises runSync edge cases", async () => {
             // 0. Setup default for initDB and state check
             mockPoolQuery.mockResolvedValue({ rows: [] });

             // 1. Database not configured
             const oldUrl = process.env.POSTGRES_URL;
             delete process.env.POSTGRES_URL;
             (sync as any).poolInstance = null; // Important to reset
             await expect(sync.runSync()).rejects.toThrow("Database not configured");
             process.env.POSTGRES_URL = oldUrl;

             // 2. Already up to date
             mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // For initDB (actually mockResolvedValue handles it)
             mockPoolQuery.mockResolvedValueOnce({ rows: [{ last_synced_block: 200 }] }); // For stateResult
             const res = await sync.runSync();
             expect(res.message).toBe("Already up to date");
             
             // 3. Trading core missing
             delete process.env.TRADING_CORE_ADDRESS;
             delete process.env.DEPLOYED_TRADING_CORE;
             await expect(sync.runSync()).rejects.toThrow("TRADING_CORE_ADDRESS");
             process.env.TRADING_CORE_ADDRESS = "0xBTC";
        });

        it("exercises Stats Route Logic Paths", async () => {
             const statsModule = await import("../routes/stats.js");
             const statsApp = express(); statsApp.use("/", statsModule.default);
             const am = await import("../services/activeMarkets.js");
             
             // Branch 1: stats.ts line 61 (non-string marketAddress)
             indexer.fetchMarkets = jest.fn().mockResolvedValue([
               { marketAddress: { toString: () => "0xm1" }, totalLongSize: "0", totalShortSize: "0" }
             ] as any);
             mockGetActive.mockResolvedValue(new Set(["0xm1"]));
             await request(statsApp).get("/");

             // Branch 2: stats.ts line 46 (TVL fetch error)
             const ethers = await import("ethers");
             (ethers.ethers.Contract as jest.Mock).mockImplementationOnce(() => ({
                totalAssets: jest.fn().mockRejectedValue(new Error("TVL Error"))
             }));
             await request(statsApp).get("/");
        });

        it("exercises User Route Logic Paths", async () => {
             const userModule = await import("../routes/user.js");
             const userApp = express(); userApp.use("/user", userModule.default);
             
             // Branch 1: user.ts line 33 (short marketId length <= 12)
             mockPoolQuery.mockResolvedValueOnce({
               rows: [{ event_type: "PositionOpened", market_id: "shortid", id: 1, created_at: new Date(), data: '["1","2","3",true,"100","10","500"]' }]
             });
             await request(userApp).get("/user/0x123/trades");
        });

        it("exercises Health Route Logic Paths", async () => {
             const healthModule = await import("../routes/health.js");
             const healthApp = express(); healthApp.use("/health", healthModule.default);
             
             // Detailed check with one failing service
             indexer.fetchProtocol = jest.fn().mockResolvedValueOnce(null);
             await request(healthApp).get("/health/detailed");
        });
    });

    describe("Indexer & Stats Logic Completion", () => {
        it("exercises fetchProtocolMetrics period branches", async () => {
            mockPoolQuery.mockResolvedValue({ rows: [] });
            await indexer.fetchProtocolMetrics(10, "day");
            await indexer.fetchProtocolMetrics(10, "hour");
        });

        it("exercises stats cache branch", async () => {
            const statsModule = await import("../routes/stats.js");
            const statsApp = express(); statsApp.use("/", statsModule.default);
            
            // First call warms cache
            await request(statsApp).get("/");
            // Second call hits cache (Date.now())
            await request(statsApp).get("/");
        });
    });

});
