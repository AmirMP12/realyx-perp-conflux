import { jest } from "@jest/globals";

// Set env BEFORE any imports
process.env.POSTGRES_URL = "postgres://localhost:5432/test";
process.env.CHAIN_ID = "71";
process.env.RPC_URL = "http://primary";
process.env.TRADING_CORE_ADDRESS = "0xTradingCore";
process.env.VAULT_CORE_ADDRESS = "0xVaultCore";
process.env.NODE_ENV = "test";

import request from "supertest";
import express from "express";

// --- Mock Variables ---
const mockPoolQuery = jest.fn();
const mockActiveMarketCount = jest.fn();
const mockActiveMarketAt = jest.fn();
const mockGetMarketInfo = jest.fn();
const mockGetFundingState = jest.fn();

// --- Setup Mocks ---
jest.mock("pg", () => {
    const mPool = {
        query: mockPoolQuery,
        on: jest.fn(),
        end: jest.fn(),
    };
    return {
        __esModule: true,
        Pool: jest.fn(() => mPool),
        default: { Pool: jest.fn(() => mPool) }
    };
});

jest.mock("ethers", () => ({
    __esModule: true,
    ethers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
        Contract: jest.fn().mockImplementation(() => ({
            activeMarketCount: mockActiveMarketCount,
            activeMarketAt: mockActiveMarketAt,
            getMarketInfo: mockGetMarketInfo,
            getFundingState: mockGetFundingState,
            totalAssets: jest.fn().mockResolvedValue(100n),
        })),
        Interface: jest.fn(),
        ZeroAddress: "0x0000000000000000000000000000000000000000"
    }
}));

jest.mock("../services/coingecko.js", () => ({
    fetchCoinGeckoPrices: jest.fn().mockResolvedValue({}),
    getCoinGeckoIdForMarket: jest.fn().mockReturnValue(null),
    fetchPriceHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock("../services/pyth.js", () => ({
    fetchPythPrices: jest.fn().mockResolvedValue({}),
    fetchPyth24hChange: jest.fn().mockResolvedValue(undefined),
    getPythTvSymbol: jest.fn().mockReturnValue(null),
    fetchPythPriceHistory: jest.fn().mockResolvedValue([]),
    fetchPythPriceHistoryHermes: jest.fn().mockResolvedValue([]),
    getPythFeedId: jest.fn().mockReturnValue(null),
}));

import * as indexer from "../services/indexer.js";
import * as onchain from "../services/fetchMarketsOnchain.js";
import debugRouter from "../routes/debug.js";
import healthRouter from "../routes/health.js";
import statsRouter from "../routes/stats.js";
import marketsRouter from "../routes/markets.js";
import userRouter from "../routes/user.js";
import leaderboardRouter from "../routes/leaderboard.js";

describe("Complete System Integration", () => {
    let app: express.Express;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetMarketInfo.mockResolvedValue({ isActive: true, isListed: true, totalLongSize: "100", totalShortSize: "50", maxLeverage: "10", maxPositionSize: "100", maxTotalExposure: "1000", totalLongCost: "10", totalShortCost: "10" });
        mockGetFundingState.mockResolvedValue({ cumulativeFunding: 0n, lastSettlement: 0n });
        mockPoolQuery.mockResolvedValue({ rows: [{ count: 1, n: 10, volume24h: "100", trades24h: 5, address: "0x123", total_trades: 5, total_volume_usd: "100", total_realized_pnl: "10", timestamp_text: "2024-01-01", timestamp_unix: 123456789 }] });
    });

    describe("Indexer Logic", () => {
        it("exercises success paths", async () => {
            await indexer.fetchProtocol();
            await indexer.fetchActiveTraders24h();
            await indexer.fetchMarkets();
            await indexer.fetchLeaderboard(10);
            await indexer.fetchProtocolMetrics(10);
            
            // Mixed events
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ event_type: "PositionOpened" }, { event_type: "PositionClosed" }, { event_type: "PositionLiquidated" }] })
                         .mockResolvedValueOnce({ rows: [{ volume_24h_usd: "100" }] });
            await indexer.fetchProtocol();
        });

        it("exercises fallbacks", async () => {
             // getPool exists branch
             indexer.getPool(); indexer.getPool();

             // No DB branches
             const oldUrl = process.env.POSTGRES_URL;
             delete process.env.POSTGRES_URL;
             await indexer.fetchProtocol();
             await indexer.fetchActiveTraders24h();
             await indexer.fetchMarkets();
             await indexer.fetchLeaderboard(10);
             await indexer.fetchProtocolMetrics(10);
             process.env.POSTGRES_URL = oldUrl;

             // No pool branch
             const poolSpy = jest.spyOn(indexer, "getPool").mockReturnValue(null);
             await indexer.fetchProtocol();
             poolSpy.mockRestore();
        });

        it("exercises mapping variety", async () => {
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ data: '["1","2","3",true]' }] });
            await indexer.fetchUserTrades("0x123", 10);
            
            mockPoolQuery.mockResolvedValueOnce({ rows: [{ n: "NaN" }] });
            await indexer.fetchActiveTraders24h();
        });
    });

    describe("Onchain Logic", () => {
        it("exercises all paths", async () => {
            mockActiveMarketCount.mockResolvedValue(3n);
            mockActiveMarketAt.mockResolvedValueOnce("0x0").mockResolvedValueOnce(null).mockResolvedValueOnce("0xM1");
            mockGetMarketInfo.mockResolvedValueOnce({ isActive: false, isListed: true }).mockResolvedValueOnce({ isActive: true, isListed: true });
            await onchain._fetchMarketsOnChainImpl();
            
            onchain.toStr(null);
            onchain.calculateInstantFundingRate(100n, 200n);
        });
    });

    describe("Routes Logic", () => {
        beforeAll(() => {
            app = express(); app.use(express.json());
            app.use("/debug", debugRouter); app.use("/health", healthRouter); app.use("/stats", statsRouter);
        });

        it("exercises routes", async () => {
            await request(app).get("/debug");
            await request(app).get("/health");
            await request(app).get("/stats");
            
            mockPoolQuery.mockRejectedValue(new Error("Fail"));
            await request(app).get("/debug");
            jest.spyOn(indexer, "fetchProtocol").mockRejectedValue(new Error("Fail"));
            await request(app).get("/health/detailed");
            await request(app).get("/stats");
        });
    });
});
