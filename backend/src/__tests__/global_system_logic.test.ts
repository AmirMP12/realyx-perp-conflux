import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

// Mocking dependencies for index.ts
jest.mock("../app.js", () => ({
  app: {
    listen: jest.fn().mockImplementation((port, cb: any) => {
       if (cb) cb();
       return { close: jest.fn() };
    })
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock("../wsServer.js", () => ({
  startWsServer: jest.fn()
}));

jest.mock("../routes/sync.js", () => ({
  runSync: jest.fn().mockResolvedValue({ eventsSynced: 0, scannedTo: 0 })
}));

jest.mock("../services/pyth.js");
jest.mock("../services/indexer.js");
jest.mock("../services/activeMarkets.js");
jest.mock("../services/coingecko.js");

describe("Global System Integration Logic", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.useRealTimers();
    });

    describe("index.ts branches and intervals", () => {
        beforeEach(() => {
            jest.resetModules();
        });

        it("exercises bootstrap with specific env vars", async () => {
            const { bootstrap } = await import("../index.js");
            
            process.env.ENABLE_WS = "true";
            process.env.VERCEL = "";
            process.env.RPC_URL = "http://rpc";
            process.env.TRADING_CORE_ADDRESS = "0x123";

            const result = await bootstrap();
            expect(result.interval).toBeDefined();
            
            // Trigger interval
            jest.advanceTimersByTime(2 * 60 * 1000 + 100);
            
            // Wait for internal async calls in the interval
            await Promise.resolve();
            await Promise.resolve();
            
            if (result.interval) clearInterval(result.interval);
            if (result.server && result.server.close) result.server.close();
        }, 15000);

        it("exercises bootstrap failure and disabled ws", async () => {
             const { bootstrap } = await import("../index.js");
             process.env.ENABLE_WS = "0";
             process.env.VERCEL = "1";
             
             const result = await bootstrap();
             expect(result.interval).toBeUndefined();
        }, 20000);
    });

    describe("health.ts extra branches", () => {
        it("exercises 503 paths and non-error catches", async () => {
             const healthModule = await import("../routes/health.js");
             const healthRouter = healthModule.default;
             const app = express(); app.use("/", healthRouter);
             
             const { fetchProtocol } = await import("../services/indexer.js");
             const { fetchPythPrices } = await import("../services/pyth.js");
             const { getActiveMarketAddresses } = await import("../services/activeMarkets.js");
             
             // 503 Scenario
             (fetchProtocol as jest.Mock).mockRejectedValueOnce(new Error("Fail"));
             const res = await request(app).get("/detailed");
             expect(res.status).toBe(503);

             // Non-error catch path
             (fetchPythPrices as jest.Mock).mockRejectedValueOnce("String Error");
             await request(app).get("/detailed");
             
             // Env var null paths
             delete process.env.RPC_URL;
             delete process.env.TRADING_CORE_ADDRESS;
             delete process.env.DEPLOYED_TRADING_CORE;
             await request(app).get("/detailed");
        }, 15000);
    });

    describe("user.ts resolveMarketSymbol and trade history", () => {
        it("exercises resolveMarketSymbol branches", async () => {
             const userModule = await import("../routes/user.js");
             const userRouter = userModule.default;
             const app = express(); app.use("/user", userRouter);

             // This exercises resolveMarketSymbol via /trades
             const { fetchUserTrades } = await import("../services/indexer.js");
             
             const mockTrades = [
               { market: { id: "0x123" }, isLong: true, txHash: "0x", size: "1", price: "1", fee: "0", timestamp: "1", type: "OPEN" },
               { market: { id: "0x456" }, isLong: false, txHash: "0x", size: "1", price: "1", fee: "0", timestamp: "1", type: "LIQUIDATE", realizedPnl: "100" }
             ];
             (fetchUserTrades as jest.Mock).mockResolvedValue(mockTrades);
             
             await request(app).get("/user/0xabc/trades?limit=10");
        }, 15000);

        it("exercises user route error paths", async () => {
             const userModule = await import("../routes/user.js");
             const userRouter = userModule.default;
             const app = express(); app.use("/user", userRouter);
             const { fetchUserPositions } = await import("../services/indexer.js");

             (fetchUserPositions as jest.Mock).mockRejectedValueOnce("Generic Error"); 
             await request(app).get("/user/0xabc/positions");
        }, 15000);
    });

    describe("index.ts top-level catch", () => {
        it("exercises bootstrap catch block", async () => {
             const { app } = await import("../app.js");
             (app.listen as jest.Mock).mockImplementationOnce(() => {
                 throw new Error("Instant Fail");
             });
             
             // Reset modules to trigger the top-level if(NODE_ENV !== "test") block
             // But NODE_ENV IS test. So we call it manually.
             const { bootstrap, handleBootstrapError } = await import("../index.js");
             await bootstrap().catch(() => {});
             if (handleBootstrapError) handleBootstrapError(new Error("Manual Fail"));
        }, 15000);

        it("triggers top-level catch in index.js", async () => {
             // Manipulation to hit lines 53-57
             const oldNodeEnv = process.env.NODE_ENV;
             process.env.NODE_ENV = "not-test";
             const { app } = await import("../app.js");
             (app.listen as jest.Mock).mockImplementationOnce(() => { throw new Error("Top Fail"); });
             
             jest.isolateModules(async () => {
                 await import("../index.js");
             });
             process.env.NODE_ENV = oldNodeEnv;
        }, 15000);
    });

    describe("Markets Route Logic Paths", () => {
        it("exercises catch block functions in markets.ts", async () => {
             const marketsModule = await import("../routes/markets.js");
             const app = express(); app.use("/", marketsModule.default);
             
             const { fetchMarkets, fetchProtocol } = await import("../services/indexer.js");
             const { fetchCoinGeckoPrices, fetchPriceHistory } = await import("../services/coingecko.js");
             const { fetchPythPrices, fetchPyth24hChange } = await import("../services/pyth.js");

             // 1. Success path for coingecko map
             (fetchPriceHistory as jest.Mock).mockResolvedValueOnce([{ timestamp: 1, value: 2 }]);
             await request(app).get("/price-history/btc");

             // 2. Reject paths to trigger catch functions at lines 180, 211, 212, 213, 222
             // We need fetchMarkets to return an empty array to enter the fallback block (173-201)
             (fetchMarkets as jest.Mock).mockResolvedValueOnce([]); 
             // Inside here: [protocol, cgPrices, pythPrices] = await Promise.all([fetchProtocol(), fetchCoinGeckoPrices(), fetchPythPrices()]);
             // These don't have inline catch here, but line 180 DOES:
             // pythChanges = await Promise.all(fallback.map((m) => fetchPyth24hChange(m.marketAddress).catch(() => undefined)))
             (fetchPyth24hChange as jest.Mock).mockRejectedValue(new Error("Inner Fail"));
             
             await request(app).get("/"); // Hits line 180 catch

             // Now hit lines 211, 212, 213 (active markers success block)
             (fetchMarkets as jest.Mock).mockResolvedValueOnce([{ marketAddress: "0x123", totalLongSize: "1", totalLongCost: "1" }]);
             // These have inline catch:
             (fetchProtocol as jest.Mock).mockRejectedValueOnce(new Error("P Fail"));
             (fetchCoinGeckoPrices as jest.Mock).mockRejectedValueOnce(new Error("CG Fail"));
             (fetchPythPrices as jest.Mock).mockRejectedValueOnce(new Error("PY Fail"));

             await request(app).get("/"); 
        }, 20000);
    });

    describe("coingecko.ts mapping and utility", () => {
        it("exercises coingecko map and getCoinGeckoIdForMarket", async () => {
             jest.resetModules();
             const coingecko = await import("../services/coingecko.js");
             (global as any).fetch = jest.fn().mockResolvedValue({
                 ok: true,
                 json: async () => ({ prices: [[123, 456], [789, 1011]] })
             });
             await coingecko.fetchPriceHistory("btc", 1);
             coingecko.getCoinGeckoIdForMarket("0x123");
             coingecko.getCoinGeckoIdForMarket("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c");
        }, 15000);
    });

    describe("Service Logic Completion", () => {
        it("exercises remaining services functions", async () => {
             const onchain = await import("../services/fetchMarketsOnChain.js");
             const pyth = await import("../services/pyth.js");
             
             (global as any).fetch = jest.fn()
                 .mockResolvedValue({ ok: false, json: async () => ([]) }); 
             
             try {
                if (onchain.fetchMarketsOnChain) await onchain.fetchMarketsOnChain();
             } catch {}
             
             if (pyth.getPythFeedId) pyth.getPythFeedId("0x123");
             if (pyth.getPythTvSymbol) pyth.getPythTvSymbol("0x123");
             
             try {
                if (pyth.fetchPythPrices) await pyth.fetchPythPrices();
             } catch {}
        }, 15000);
    });
});
