import request from "supertest";
import { app } from "../app.js";
import * as indexer from "../services/indexer.js";

jest.mock("../services/indexer.js");
const mockedIndexer = indexer as jest.Mocked<typeof indexer>;

describe("Insurance Route Logic Paths", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("prefixes txHash with 0x when missing and preserves coveredAt values", async () => {
        const mockClaims = [
            {
                id: 1,
                claimId: "1",
                positionId: "1",
                amount: "1000000",
                submittedAt: "1704067200",
                coveredAt: null, // coveredAt is null
                txHash: "ABC", // txHash does not start with 0x
            },
            {
                id: 2,
                claimId: "2",
                positionId: "2",
                amount: "2000000",
                submittedAt: "1704067200",
                coveredAt: "1704067300", // coveredAt is set
                txHash: "0x123", // txHash already starts with 0x
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

    it("returns a generic error message when a non-Error is thrown", async () => {
        mockedIndexer.fetchBadDebtClaims.mockRejectedValue("String error"); // non-Error rejection
        
        const res = await request(app).get("/api/insurance/claims");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe("Failed to fetch claims");
    });

    it("returns the error message when an Error is thrown", async () => {
        mockedIndexer.fetchBadDebtClaims.mockRejectedValue(new Error("Typed error")); // Error instance rejection
        
        const res = await request(app).get("/api/insurance/claims");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe("Typed error");
    });
});
