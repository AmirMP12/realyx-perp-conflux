import request from "supertest";
import { app } from "../app.js";
import fs from "fs";
import { ethers } from "ethers";

// Mock dependencies
jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

const mockWait = jest.fn().mockResolvedValue({ hash: "0xTxHash" });
const mockUpdatePriceFeeds = jest.fn().mockResolvedValue({ hash: "0xTxHash", wait: mockWait });
const mockOracleConfig = jest.fn();
const mockOracleAggregator = jest.fn().mockResolvedValue("0xOracleAddr");
const mockPythAddr = jest.fn().mockResolvedValue("0xPythAddr");
const mockUpdateFee = jest.fn().mockResolvedValue(100n);

jest.mock("ethers", () => {
    const actual = jest.requireActual("ethers");
    const mProvider = jest.fn().mockImplementation(() => ({
        getLogs: jest.fn(),
    }));
    const mWallet = jest.fn().mockImplementation(() => ({}));
    const mContract = jest.fn().mockImplementation(() => ({
        oracleAggregator: mockOracleAggregator,
        pyth: mockPythAddr,
        getOracleConfig: mockOracleConfig,
        getUpdateFee: mockUpdateFee,
        updatePriceFeeds: mockUpdatePriceFeeds,
    }));

    const mEthers = {
        JsonRpcProvider: mProvider,
        Wallet: mWallet,
        Contract: mContract,
        isAddress: (s: string) => typeof s === "string" && s.startsWith("0x") && s.length === 42,
        ZeroHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    return {
        ...mEthers,
        ethers: mEthers,
    };
});

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("Pyth Refresh Route Extended Scenarios", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = "test-secret";
        process.env.PRIVATE_KEY = "0x123";
        process.env.TRADING_CORE_ADDRESS = "0xTradingCore";
        mockWait.mockResolvedValue({ hash: "0xTxHash" });
        mockOracleConfig.mockResolvedValue(["0xFeedId"]);
        mockOracleAggregator.mockResolvedValue("0xOracleAddr");
        mockPythAddr.mockResolvedValue("0xPythAddr");
        mockUpdateFee.mockResolvedValue(100n);
        mockUpdatePriceFeeds.mockResolvedValue({ hash: "0xTxHash", wait: mockWait });
    });

    describe("loadTradingCoreAddress", () => {
        it("should load from file if env missing", async () => {
            delete process.env.TRADING_CORE_ADDRESS;
            delete process.env.DEPLOYED_TRADING_CORE;
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ contracts: { tradingCore: "0xFileAddr" } }));
            
            mockOracleConfig.mockResolvedValue([ethers.ZeroHash]);
            
            const res = await request(app)
                .get("/api/pyth-refresh?markets=0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c")
                .set("Authorization", "Bearer test-secret");
            
            expect(mockedFs.readFileSync).toHaveBeenCalled();
            // Since feedId is ZeroHash, it will return success but no feeds
            expect(res.body.message).toBe("No Pyth feeds for given markets");
        });

        it("should return 500 if both env and file are missing", async () => {
            delete process.env.TRADING_CORE_ADDRESS;
            delete process.env.DEPLOYED_TRADING_CORE;
            mockedFs.existsSync.mockReturnValue(false);
            
            const res = await request(app)
                .get("/api/pyth-refresh?markets=0x123")
                .set("Authorization", "Bearer test-secret");
            
            expect(res.status).toBe(500);
            expect(res.body.error).toContain("missing");
        });

        it("should handle JSON parse error in deployment file", async () => {
             delete process.env.TRADING_CORE_ADDRESS;
             mockedFs.existsSync.mockReturnValue(true);
             mockedFs.readFileSync.mockReturnValue("invalid json");
             
             const res = await request(app)
                .get("/api/pyth-refresh?markets=0x123")
                .set("Authorization", "Bearer test-secret");
             
             expect(res.status).toBe(500);
        });
    });

    describe("GET /api/pyth-refresh", () => {
        it("should handle unauthorized cron request", async () => {
            const res = await request(app).get("/api/pyth-refresh");
            expect(res.status).toBe(401);
        });

        it("should handle missing private key", async () => {
            delete process.env.PRIVATE_KEY;
            delete process.env.KEEPER_PRIVATE_KEY;
            delete process.env.PYTH_REFRESH_PRIVATE_KEY;
            
            const res = await request(app)
                .get("/api/pyth-refresh")
                .set("Authorization", "Bearer test-secret");
            
            expect(res.status).toBe(500);
            expect(res.body.error).toContain("Set PYTH_REFRESH_PRIVATE_KEY");
        });

        it("should handle missing markets param", async () => {
            const res = await request(app)
                .get("/api/pyth-refresh")
                .set("Authorization", "Bearer test-secret");
            
            expect(res.status).toBe(400);
            expect(res.body.error).toContain("Query required");
        });

        it("should handle invalid market address", async () => {
            const res = await request(app)
                .get("/api/pyth-refresh?markets=invalid")
                .set("Authorization", "Bearer test-secret");
            
            expect(res.status).toBe(400);
            expect(res.body.error).toContain("Invalid market address");
        });

        it("should handle Hermes returning no binary data", async () => {
            mockOracleConfig.mockResolvedValue(["0xFeedId"]);
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ binary: { data: [] } })
            });
            
            const res = await request(app)
                .get("/api/pyth-refresh?markets=0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c")
                .set("Authorization", "Bearer test-secret");
            
            expect(res.status).toBe(502);
            expect(res.body.error).toContain("Hermes returned no binary update data");
        });

        it("should handle Hermes non-ok response", async () => {
            mockOracleConfig.mockResolvedValue(["0xFeedId"]);
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: () => Promise.resolve("Internal Error")
            });
            
            const res = await request(app)
                .get("/api/pyth-refresh?markets=0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c")
                .set("Authorization", "Bearer test-secret");
            
            expect(res.status).toBe(500);
            expect(res.body.error).toContain("Hermes 500");
        });

        it("should handle general failure in try-catch", async () => {
            mockOracleAggregator.mockRejectedValue(new Error("Generic Failure"));
            
            const res = await request(app)
                .get("/api/pyth-refresh?markets=0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c")
                .set("Authorization", "Bearer test-secret");
            
            expect(res.status).toBe(500);
            expect(res.body.error).toBe("Generic Failure");
        });
        
        it("should successfully refresh prices", async () => {
            mockOracleConfig.mockResolvedValue(["0xFeedId"]);
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ binary: { data: ["0xData"] } })
            });
            
            const res = await request(app)
                .get("/api/pyth-refresh?markets=0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c")
                .set("Authorization", "Bearer test-secret");
            
            if (res.status !== 200) console.error("Refresh error body:", JSON.stringify(res.body));
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.txHash).toBeDefined();
        });
    });
});
