import request from "supertest";
import { app } from "../app.js";
import { jest } from "@jest/globals";
import * as indexer from "../services/indexer.js";

describe("User Route Logic Paths", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("hits resolveMarketSymbol branches (29, 31, 33)", async () => {
        jest.spyOn(indexer, "fetchUserTrades").mockResolvedValue([
            { market: { id: "" }, txHash: "0x1", isLong: true, size: "1", price: "1", fee: "0.1", realizedPnl: "0", timestamp: "1713400000", type: "OPEN" },
            { market: { id: "0xKnown" }, txHash: "0x2", isLong: true, size: "1", price: "1", fee: "0.1", realizedPnl: "0", timestamp: "1713400000", type: "OPEN" },
            { market: { id: "0xVeryLongAddressThatShouldBeTruncated" }, txHash: "0x3", isLong: true, size: "1", price: "1", fee: "0.1", realizedPnl: "0", timestamp: "1713400000", type: "OPEN" }
        ] as any);
        
        // Mock MARKET_SYMBOL
        const userModule = require("../routes/user.js");
        // We can't easily mock internal const, but we can trigger the resolve by calling the route
        
        const res = await request(app).get("/api/user/0xUserAddress/trades");
        expect(res.status).toBe(200);
        // "Unknown" for empty id
        // Truncated for long id
    });

    it("hits validation and catch branches in positions (38-39, 64-66)", async () => {
        // empty address (params address is part of path, so hard to make it null but can make it space)
        const res1 = await request(app).get("/api/user/%20/positions");
        expect(res1.status).toBe(400);

        // catch block
        jest.spyOn(indexer, "fetchUserPositions").mockRejectedValue(new Error("Indexer Fail"));
        const res2 = await request(app).get("/api/user/0xUser/positions");
        expect(res2.body.success).toBe(false);
    });

    it("hits validation and catch branches in trades (73-74, 92-94)", async () => {
        // empty address
        const res1 = await request(app).get("/api/user/%20/trades");
        expect(res1.status).toBe(400);

        // catch block
        jest.spyOn(indexer, "fetchUserTrades").mockRejectedValue(new Error("Indexer Fail"));
        const res2 = await request(app).get("/api/user/0xUser/trades");
        expect(res2.body.success).toBe(false);
    });
});
