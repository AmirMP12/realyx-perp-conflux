import request from "supertest";
import { app } from "../app.js";
import * as indexer from "../services/indexer.js";

jest.mock("../services/indexer.js");

describe("User Routes Extended Scenarios", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("GET /api/user/:address/positions", () => {
        it("should return 400 if address is missing or whitespace", async () => {
            const res = await request(app).get("/api/user/%20/positions");
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it("should handle error in fetchUserPositions", async () => {
            (indexer.fetchUserPositions as jest.Mock).mockRejectedValueOnce(new Error("Fetch Fail"));
            const res = await request(app).get("/api/user/0x123/positions");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Fetch Fail");
        });
    });

    describe("GET /api/user/:address/trades", () => {
        it("should return 400 if address is missing", async () => {
             // Express router might not match /api/user//trades, but let's test with empty string if possible
             // However, the route is /:address/trades, so we test with a space
            const res = await request(app).get("/api/user/%20/trades");
            expect(res.status).toBe(400);
        });

        it("should return trades with resolved symbols", async () => {
            (indexer.fetchUserTrades as jest.Mock).mockResolvedValueOnce([
                {
                    id: "1",
                    txHash: "0xHash",
                    market: { id: "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c" }, // CFX-USD
                    isLong: true,
                    size: "1000000000000000000",
                    price: "1000000000000000000",
                    realizedPnl: "1000000000000000000",
                    fee: "0",
                    type: "OPEN",
                    timestamp: "1713400000"
                },
                {
                    id: "2",
                    txHash: "0xHash2",
                    market: { id: "0x1234567890123456789012345678901234567890" },
                    isLong: false,
                    size: "1000000000000000000",
                    price: "1000000000000000000",
                    realizedPnl: "0",
                    fee: "0",
                    type: "LIQUIDATE",
                    timestamp: "1713400001"
                }
            ]);

            const res = await request(app).get("/api/user/0x123/trades?limit=10");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data[0].market).toBe("CFX-USD");
            expect(res.body.data[1].market).toBe("0x1234…7890");
            expect(res.body.data[1].type).toBe("LIQUIDATED");
        });

        it("should handle error in fetchUserTrades", async () => {
            (indexer.fetchUserTrades as jest.Mock).mockRejectedValueOnce(new Error("Trade Fetch Fail"));
            const res = await request(app).get("/api/user/0x123/trades");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe("Trade Fetch Fail");
        });
    });
});
