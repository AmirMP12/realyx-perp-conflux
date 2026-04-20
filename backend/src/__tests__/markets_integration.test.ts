import request from "supertest";
import { app } from "../app.js";
import * as indexer from "../services/indexer.js";
import * as coingecko from "../services/coingecko.js";
import * as pyth from "../services/pyth.js";
import * as activeMarkets from "../services/activeMarkets.js";

import { clearMarketsCache } from "../routes/markets.js";

const VALID_ADDR = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
const VALID_TX = "0x1234567890123456789012345678901234567890123456789012345678901234";

jest.mock("../services/indexer.js", () => ({
    fetchMarkets: jest.fn().mockResolvedValue([]),
    fetchProtocol: jest.fn().mockResolvedValue({ totalVolumeUsd: "1000" }),
}));

jest.mock("../services/coingecko.js", () => ({
    fetchCoinGeckoPrices: jest.fn().mockResolvedValue({ conflux: { price: 0.2, change24h: 5 } }),
    getCoinGeckoIdForMarket: jest.fn().mockReturnValue("conflux"),
    fetchPriceHistory: jest.fn().mockResolvedValue([[1713400000000, 0.2]]),
}));

jest.mock("../services/pyth.js", () => ({
    fetchPythPrices: jest.fn().mockResolvedValue({ "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c": 0.21 }),
    fetchPyth24hChange: jest.fn().mockResolvedValue(4.5),
    getPythTvSymbol: jest.fn().mockReturnValue("CFX/USD"),
    fetchPythPriceHistory: jest.fn().mockResolvedValue([{ time: 1713400000, value: 0.21 }]),
    getPythFeedId: jest.fn().mockReturnValue("0xFeedId"),
    fetchPythPriceHistoryHermes: jest.fn().mockResolvedValue([{ time: 1713400000, value: 0.215 }]),
}));


jest.mock("../services/activeMarkets.js", () => ({
    getActiveMarketAddresses: jest.fn().mockResolvedValue(new Set(["0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c"])),
}));

describe("Markets Route Integration Scenarios", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearMarketsCache();
    });

    describe("GET /api/markets", () => {
        it("should return fallback enriched markets when fetchMarkets is empty", async () => {
            (indexer.fetchMarkets as jest.Mock).mockResolvedValueOnce([]);
            const res = await request(app).get("/api/markets");
            expect(res.status).toBe(200);
            expect(res.body.fallback).toBe(true);
            expect(res.body.data[0].indexPrice).toBe("0.21"); // Pyth takes precedence
        });

        it("should return normal markets when fetchMarkets has data", async () => {
            const mockMarket = {
                id: "1",
                marketAddress: VALID_ADDR,
                totalLongSize: "1000000000000000000000",
                totalLongCost: "200000000000000000000",
                totalShortSize: "0",
                totalShortCost: "0",
                isActive: true,
                fundingRate: "1000000000000",
                volume24h: "5000"
            };
            (indexer.fetchMarkets as jest.Mock).mockResolvedValueOnce([mockMarket]);
            
            const res = await request(app).get("/api/markets");
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].indexPrice).toBe("0.21"); // Pyth
        });

        it("should use cache on second call", async () => {
            (indexer.fetchMarkets as jest.Mock).mockResolvedValueOnce([]);
            await request(app).get("/api/markets");
            await request(app).get("/api/markets");
            expect(indexer.fetchMarkets).toHaveBeenCalledTimes(1);
        });

        it("should handle error and return basic fallback", async () => {
            (indexer.fetchMarkets as jest.Mock).mockRejectedValueOnce(new Error("Fatal"));
            (coingecko.fetchCoinGeckoPrices as jest.Mock).mockRejectedValueOnce(new Error("Fatal"));
            
            const res = await request(app).get("/api/markets");
            expect(res.status).toBe(200);
            expect(res.body.fallback).toBe(true);
        });
    });

    describe("GET /api/markets/price-history/:marketId", () => {
        it("should return Pyth prices if available", async () => {
            const res = await request(app).get(`/api/markets/price-history/${VALID_ADDR}`);
            expect(res.status).toBe(200);
            expect(res.body.data[0].value).toBe(0.21);
            expect(pyth.fetchPythPriceHistory).toHaveBeenCalled();
        });

        it("should fallback to Hermes if Pyth fails", async () => {
            (pyth.fetchPythPriceHistory as jest.Mock).mockResolvedValueOnce([]);
            const res = await request(app).get(`/api/markets/price-history/${VALID_ADDR}`);
            expect(res.body.data[0].value).toBe(0.215);
            expect(pyth.fetchPythPriceHistoryHermes).toHaveBeenCalled();
        });

        it("should fallback to CoinGecko if Pyth/Hermes both empty", async () => {
            (pyth.fetchPythPriceHistory as jest.Mock).mockResolvedValueOnce([]);
            (pyth.fetchPythPriceHistoryHermes as jest.Mock).mockResolvedValueOnce([]);
            const res = await request(app).get(`/api/markets/price-history/${VALID_ADDR}`);
            expect(res.body.data[0]).toEqual([1713400000000, 0.2]);
        });

        it("should return 404 if market has no CG ID", async () => {
            (coingecko.getCoinGeckoIdForMarket as jest.Mock).mockReturnValueOnce(null);
            (pyth.getPythTvSymbol as jest.Mock).mockReturnValueOnce(null);
            const res = await request(app).get("/api/markets/price-history/0xUnknown");
            expect(res.status).toBe(404);
        });
    });
});
