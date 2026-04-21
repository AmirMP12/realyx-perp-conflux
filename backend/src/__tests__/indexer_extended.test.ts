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
        it("should handle pool null and volume fallback (155, 159)", async () => {
            delete process.env.POSTGRES_URL;
            jest.resetModules();
            const ind = require("../services/indexer.js");
            // Hit 154 (test env)
            const res = await ind.fetchProtocol();
            expect(res?.totalVolumeUsd).toBe("50000");

            // Hit 155 (not test env)
            process.env.NODE_ENV = "production";
            const res2 = await ind.fetchProtocol();
            expect(res2).toBeNull();
        });

        it("should hit all event counting loop branches (163-173)", async () => {
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

        it("should handle DB fail in sync while keeping on-chain data (Branch 278)", async () => {
            const ind = require("../services/indexer.js");
            jest.mock("../services/fetchMarketsOnchain.js", () => ({
                fetchMarketsOnChain: jest.fn().mockResolvedValue([{ id: "0x1", marketAddress: "0x1" }])
            }));

            pool.query.mockRejectedValue(new Error("DB Sync Fail"));
            const res = await ind.fetchMarkets();
            expect(res.length).toBeGreaterThan(0);
        });

        it("should trigger critical failure in fetchMarkets (294-297)", async () => {
            // Force import or setup to fail
            const onchain = require("../services/fetchMarketsOnchain.js");
            jest.spyOn(onchain, "fetchMarketsOnChain").mockImplementation(() => {
                throw new Error("Critical Indexer Fail");
            });
            
            const ind = require("../services/indexer.js");
            const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
            const res = await ind.fetchMarkets();
            expect(res).toEqual([]);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("critical failure"), expect.any(String));
            warnSpy.mockRestore();
        });
    });

    describe("Position and Trade Logic", () => {
        it("should hit leverage 10 and leverage 0 math (Branch 335)", async () => {
            pool.query.mockResolvedValue({ 
                rows: [
                    { data: '["0x1", "0xT", "0xM", true, "1000", "10", "20000"]', created_at: Date.now() },
                    { data: '["0x2", "0xT", "0xM", true, "500", "0", "21000"]', created_at: Date.now() }
                ] 
            });
            const pos = await indexer.fetchUserPositions("0xUser");
            expect(pos[0].collateralAmount).toBe("100");
            expect(pos[1].collateralAmount).toBe("0");
        });

        it("should resolve market ID from open_event for liquidate/close (Branch 424-434)", async () => {
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
        it("triggers fetchActiveTraders24h catch (186)", async () => {
            pool.query.mockRejectedValueOnce(new Error("Global Fail"));
            expect(await indexer.fetchActiveTraders24h()).toBe(0);
        });

        it("triggers fetchUserPositions catch (363)", async () => {
            pool.query.mockRejectedValueOnce(new Error("Pos Fail"));
            expect(await indexer.fetchUserPositions("0x1")).toEqual([]);
        });

        it("handles dev fallback (584) and prod leaderboard catch (593)", async () => {
            pool.query.mockRejectedValue(new Error("Fail"));
            process.env.NODE_ENV = "development";
            const resDev = await indexer.fetchLeaderboard(10);
            expect(resDev.length).toBe(3);
            
            process.env.NODE_ENV = "production";
            expect(await indexer.fetchLeaderboard(10)).toEqual([]);
        });

        it("hits metrics catch (669-670)", async () => {
            pool.query.mockRejectedValue(new Error("Fail"));
            expect(await indexer.fetchProtocolMetrics(10)).toEqual([]);
        });

        it("hits fetchUserTrades catch (476)", async () => {
            pool.query.mockRejectedValue(new Error("Fail"));
            expect(await indexer.fetchUserTrades("0x1", 10)).toEqual([]);
        });

        it("hits fetchProtocol catch (186)", async () => {
             // To hit line 186, getPool must not throw, but something inside the try must.
             // If we mock getPool to returns something that throws on query
             pool.query.mockImplementation(() => { throw new Error("Hard Fail"); });
             expect(await indexer.fetchProtocol()).toBeNull();
        });

        it("hits fetchLeaderboard and fetchProtocolMetrics catch blocks (582, 669)", async () => {
             pool.query.mockRejectedValue(new Error("Database Error"));
             
             // Leaderboard catch (production)
             process.env.NODE_ENV = "production";
             const lb = await indexer.fetchLeaderboard(10);
             expect(lb).toEqual([]);

             // Metrics catch
             const metrics = await indexer.fetchProtocolMetrics(10);
             expect(metrics).toEqual([]);
        });
    });
});
