import pg from "pg";

// Mock pg
jest.mock("pg", () => {
    const mPool = {
        query: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool) };
});

describe("Indexer Service Absolute Recovery Suite", () => {
    let pool: any;
    let indexer: any;

    beforeEach(() => {
        jest.resetModules();
        process.env.POSTGRES_URL = "postgres://localhost:5432/test";
        process.env.NODE_ENV = "test";
        
        indexer = require("../services/indexer.js");
        const { Pool } = require("pg");
        pool = new Pool();
        jest.clearAllMocks();
    });

    describe("Protocol Stats", () => {
        it("falls back to a default volume in test mode and returns null in production", async () => {
            delete process.env.POSTGRES_URL;
            jest.resetModules();
            const ind = require("../services/indexer.js");
            // test environment default
            const res = await ind.fetchProtocol();
            expect(res?.totalVolumeUsd).toBe("50000");

            // production with no database
            process.env.NODE_ENV = "production";
            const res2 = await ind.fetchProtocol();
            expect(res2).toBeNull();
        });

        it("aggregates event counts into protocol totals", async () => {
            pool.query.mockImplementation((sql: string) => {
                if (sql.includes("COUNT(*) as count")) {
                    return Promise.resolve({ rows: [
                        { event_type: "PositionOpened", count: "10" },
                        { event_type: "PositionClosed", count: "5" },
                        { event_type: "PositionLiquidated", count: "2" },
                        { event_type: "Other", count: "1" }
                    ] });
                }
                return Promise.resolve({ rows: [{ volume_24h_usd: "1000" }] });
            });
            const res = await indexer.fetchProtocol();
            expect(res?.totalPositionsOpened).toBe("10");
            expect(res?.totalLiquidations).toBe("2");
            expect(res?.totalTrades).toBe("17");
        });

        it("should handle mixed numeric counting query failure", async () => {
             pool.query.mockImplementation((sql: string) => {
                if (sql.includes("COUNT(*) as count")) return Promise.resolve({ rows: [] });
                return Promise.reject(new Error("Metric Fail"));
            });
            const res = await indexer.fetchProtocol();
            expect(res?.totalVolumeUsd).toBe("0");
        });
    });

    describe("Markets", () => {
        it("should merge on-chain data with DB stats correctly", async () => {
             jest.mock("../services/fetchMarketsOnchain.js", () => ({
                fetchMarketsOnChain: jest.fn().mockResolvedValue([{ id: "0x1", marketAddress: "0x1" }])
            }));
            pool.query.mockResolvedValue({ 
                rows: [{ market_id: "0x1", volume24h: "500", trades24h: 10 }] 
            });
            const res = await indexer.fetchMarkets();
            expect(res[0].volume24h).toBe("500");
        });

        it("keeps on-chain market data when the DB sync query fails", async () => {
            const ind = require("../services/indexer.js");
            jest.mock("../services/fetchMarketsOnchain.js", () => ({
                fetchMarketsOnChain: jest.fn().mockResolvedValue([{ id: "0x1", marketAddress: "0x1" }])
            }));

            pool.query.mockRejectedValue(new Error("DB Sync Fail"));
            const res = await ind.fetchMarkets();
            expect(res.length).toBeGreaterThan(0);
        });

        it("returns an empty list when the on-chain fetch throws", async () => {
            // Force the on-chain fetch to throw
            const onchain = require("../services/fetchMarketsOnchain.js");
            jest.spyOn(onchain, "fetchMarketsOnChain").mockImplementation(() => {
                throw new Error("Critical Indexer Fail");
            });
            
            const ind = require("../services/indexer.js");
            const res = await ind.fetchMarkets();
            expect(res).toEqual([]);
        });
    });

    describe("Position and Trade Logic", () => {
        it("computes collateral from leverage and leaves it at zero when leverage is zero", async () => {
            // size and leverage are 1e18-scaled on-chain; margin = size * 1e18 / leverage.
            pool.query.mockResolvedValue({ 
                rows: [
                    { data: '["0x1", "0xT", "0xM", true, "1000000000000000000000", "10000000000000000000", "20000"]', created_at: Date.now() },
                    { data: '["0x2", "0xT", "0xM", true, "500", "0", "21000"]', created_at: Date.now() }
                ] 
            });
            const pos = await indexer.fetchUserPositions("0xUser");
            expect(pos[0].collateralAmount).toBe("100000000000000000000"); // 1000e18 * 1e18 / 10e18 = 100e18
            expect(pos[1].collateralAmount).toBe("0"); // leverage 0 → margin stays 0
        });

        it("resolves the market id from the open event for close and liquidate trades", async () => {
            pool.query.mockResolvedValue({ 
                rows: [
                    { 
                        id: 1, event_type: "PositionOpened", 
                        data: '["0xP1", "0xUser", "0xM", "true", "1000", "10", "20000"]',
                        created_at: Date.now()
                    },
                    { 
                        id: 2, event_type: "PositionClosed", market_id: "0x",
                        data: '["0xP1", "0xUser", "21000", "100"]', 
                        open_data: '["0xP1", "0xUser", "0xRealMarket", true, "1000"]',
                        open_market_id: "0xRealMarket",
                        created_at: Date.now()
                    },
                    { 
                        id: 3, event_type: "PositionLiquidated", market_id: "0x",
                        data: '["0xP1", "0xUser", "19000"]', 
                        open_data: '["0xP1", "0xUser", "0xRealMarket2", true, "1050"]',
                        open_market_id: "0xRealMarket2",
                        created_at: Date.now()
                    }
                ] 
            });
            const trades = await indexer.fetchUserTrades("0xUser", 10);
            expect(trades[0].isLong).toBe(true);
            expect(trades[1].market.id).toBe("0xRealMarket");
            expect(trades[2].market.id).toBe("0xRealMarket2");
            expect(trades[2].size).toBe("1050");
        });
    });

    describe("Catch Blocks and Fallbacks", () => {
        it("returns 0 when the fetchActiveTraders24h query fails", async () => {
            pool.query.mockRejectedValueOnce(new Error("Global Fail"));
            expect(await indexer.fetchActiveTraders24h()).toBe(0);
        });

        it("returns an empty list when the fetchUserPositions query fails", async () => {
            pool.query.mockRejectedValueOnce(new Error("Pos Fail"));
            expect(await indexer.fetchUserPositions("0x1")).toEqual([]);
        });

        it("returns an empty leaderboard when the query fails in development and production", async () => {
            pool.query.mockRejectedValue(new Error("Fail"));
            process.env.NODE_ENV = "development";
            const resDev = await indexer.fetchLeaderboard(10);
            expect(resDev).toEqual([]);
            
            process.env.NODE_ENV = "production";
            expect(await indexer.fetchLeaderboard(10)).toEqual([]);
        });

        it("returns empty metrics when the protocol metrics query fails", async () => {
            pool.query.mockRejectedValue(new Error("Fail"));
            expect(await indexer.fetchProtocolMetrics(10)).toEqual([]);
        });

        it("returns an empty trade list when the query fails", async () => {
            pool.query.mockRejectedValue(new Error("Fail"));
            expect(await indexer.fetchUserTrades("0x1", 10)).toEqual([]);
        });

        it("returns null when the protocol query throws", async () => {
             // getPool succeeds but the query inside the try throws
             pool.query.mockImplementation(() => { throw new Error("Hard Fail"); });
             expect(await indexer.fetchProtocol()).toBeNull();
        });

        it("returns empty results when the leaderboard and metrics queries fail", async () => {
             pool.query.mockRejectedValue(new Error("Database Error"));
             
             // leaderboard failure in production
             process.env.NODE_ENV = "production";
             const lb = await indexer.fetchLeaderboard(10);
             expect(lb).toEqual([]);

             // metrics failure
             const metrics = await indexer.fetchProtocolMetrics(10);
             expect(metrics).toEqual([]);
        });
    });
});
