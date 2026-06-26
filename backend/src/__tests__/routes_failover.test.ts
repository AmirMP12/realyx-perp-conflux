import request from "supertest";
import { app } from "../app.js";
import { jest } from "@jest/globals";

describe("Routes Failover", () => {
    beforeEach(() => {
        const markets = require("../routes/markets.js");
        markets.clearMarketsCache();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("GET /health", () => {
        it("should return 503 if a check fails", async () => {
            // Mock fetchProtocol to throw
            const indexer = require("../services/indexer.js");
            const spyIndex = jest.spyOn(indexer, "fetchProtocol").mockRejectedValue(new Error("Indexer failed"));
            
            // Mock other checks to prevent network calls/timeouts
            const pyth = require("../services/pyth.js");
            const spyPyth = jest.spyOn(pyth, "fetchPythPrices").mockResolvedValue({});
            const activeMarkets = require("../services/activeMarkets.js");
            const spyActive = jest.spyOn(activeMarkets, "getActiveMarketAddresses").mockResolvedValue(new Set());

            const res = await request(app).get("/health/detailed");
            expect(res.status).toBe(503);
            expect(res.body.ok).toBe(false);
            expect(res.body.checks.indexer.ok).toBe(false);
            
            spyIndex.mockRestore();
            spyPyth.mockRestore();
            spyActive.mockRestore();
        });
    });

    describe("GET /markets", () => {
        it("renders a fallback name for an unknown market address", async () => {
            // We need a request that triggers enrichment for an unknown market.
            // If fetchMarkets returns a market not in MARKET_META.
            const indexer = require("../services/indexer.js");
            jest.spyOn(indexer, "fetchMarkets").mockResolvedValueOnce([
                { id: "0xUnk", marketAddress: "0xUnknownAddressThatIsVeryLong", isActive: true }
            ]);
            const activeMarkets = require("../services/activeMarkets.js");
            jest.spyOn(activeMarkets, "getActiveMarketAddresses").mockResolvedValueOnce(new Set(["0xunknownaddressthatisverylong"]));
            
            const res = await request(app).get("/api/markets");
            expect(res.status).toBe(200);
            expect(res.body.data[0].name).toContain("0xUnknownAddressThatIsVeryLong".slice(0, 10));
        });

        it("serves fallback markets when fetchMarkets and price sources fail", async () => {
            const indexer = require("../services/indexer.js");
            jest.spyOn(indexer, "fetchMarkets").mockRejectedValueOnce(new Error("Markets Fail"));
            const activeMarkets = require("../services/activeMarkets.js");
            jest.spyOn(activeMarkets, "getActiveMarketAddresses").mockResolvedValueOnce(new Set());
            
            // The internal catch builds fallback markets when fetchMarkets fails,
            // and the inner catches handle fetchProtocol and pyth failures too
            const pyth = require("../services/pyth.js");
            jest.spyOn(pyth, "fetchPythPrices").mockRejectedValueOnce(new Error("Pyth Fail"));
            
            const res = await request(app).get("/api/markets");
            expect(res.status).toBe(200);
            expect(res.body.fallback).toBe(true);
        });

        it("returns an error payload when fallback enrichment fails", async () => {
             const indexer = require("../services/indexer.js");
             jest.spyOn(indexer, "fetchMarkets").mockRejectedValueOnce(new Error("Markets Fail"));
             
             // Force the enrichment path to fail by making the parallel
             // price fetch throw
             const coingecko = require("../services/coingecko.js");
             jest.spyOn(coingecko, "fetchCoinGeckoPrices").mockImplementationOnce(() => { throw new Error("Hard Fail"); });
             
             const res = await request(app).get("/api/markets");
             expect(res.status).toBe(200);
             expect(res.body.success).toBe(false);
             expect(res.body.error).toBe("Markets Fail");
        });
    });

    describe("GET /markets/price-history/:marketId", () => {
        it("returns an error payload when price history lookup fails", async () => {
            const coingecko = require("../services/coingecko.js");
            jest.spyOn(coingecko, "fetchPriceHistory").mockRejectedValueOnce(new Error("CG History Fail"));
            
            // CFA address
            const res = await request(app).get("/api/markets/price-history/0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        });
    });
});
