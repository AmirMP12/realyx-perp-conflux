import request from "supertest";
import { app } from "../app.js";
import * as indexer from "../services/indexer.js";

jest.mock("../services/indexer.js");
const mockedIndexer = indexer as jest.Mocked<typeof indexer>;

describe("Insurance Route Logic Paths", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should cover different txHash formats and coveredAt null branch", async () => {
        const mockClaims = [
            {
                id: 1,
                claimId: "1",
                positionId: "1",
                amount: "1000000",
                submittedAt: "1704067200",
                coveredAt: null, // Branch 1: coveredAt is null
                txHash: "ABC", // Branch 2: txHash does NOT start with 0x
            },
            {
                id: 2,
                claimId: "2",
                positionId: "2",
                amount: "2000000",
                submittedAt: "1704067200",
                coveredAt: "1704067300", // Branch 3: coveredAt is NOT null
                txHash: "0x123", // Branch 4: txHash starts with 0x
            }
        ];
        
        mockedIndexer.fetchBadDebtClaims.mockResolvedValue(mockClaims as any);
        
        const res = await request(app).get("/api/insurance/claims");
        expect(res.status).toBe(200);
        expect(res.body.data[0].coveredAt).toBeNull();
        expect(res.body.data[0].txHash).toBe("0xABC");
        expect(res.body.data[1].coveredAt).toBeDefined();
        expect(res.body.data[1].txHash).toBe("0x123");
    });

    it("should cover catch block with non-Error object", async () => {
        mockedIndexer.fetchBadDebtClaims.mockRejectedValue("String error"); // Branch 5: catches non-Error
        
        const res = await request(app).get("/api/insurance/claims");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe("Failed to fetch claims");
    });

    it("should cover catch block with Error object", async () => {
        mockedIndexer.fetchBadDebtClaims.mockRejectedValue(new Error("Typed error")); // Branch 6: catches Error instance
        
        const res = await request(app).get("/api/insurance/claims");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe("Typed error");
    });
});
