import { jest } from "@jest/globals";

// Mock the data + engine dependencies used by the social router.
const mockQuery = jest.fn<any>();
let mockPool: any = { query: mockQuery };
const mockFetchUserPositions = jest.fn<any>();
const mockRefresh = jest.fn<any>().mockResolvedValue(undefined);
let mockEngine: any = { refreshLeadTraders: mockRefresh };

jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  getPool: () => mockPool,
  fetchUserPositions: (...args: any[]) => mockFetchUserPositions(...args),
}));

jest.mock("../services/copyEngine.js", () => ({
  __esModule: true,
  getCopyEngine: () => mockEngine,
}));

// Stop the sync router from kicking off work during app import.
jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

import request from "supertest";
import { app } from "../app.js";

const ADDR = "0xABCDEF0000000000000000000000000000000001";

/** Queue a successful `isCopySchemaReady` response (the first query each
 *  handler now runs). Follow it with the handler's data-query mocks. */
const schemaReady = () =>
  mockQuery.mockResolvedValueOnce({
    rows: [{ lead: "lead_traders", stats: "lead_trader_stats" }],
  });

/** Queue an `isCopySchemaReady` response signalling the schema is absent. */
const schemaMissing = () => mockQuery.mockResolvedValueOnce({ rows: [{ lead: null, stats: null }] });

describe("Social routes", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockFetchUserPositions.mockReset();
    mockFetchUserPositions.mockResolvedValue([]);
    mockRefresh.mockClear();
    mockPool = { query: mockQuery };
    mockEngine = { refreshLeadTraders: mockRefresh };
  });

  describe("GET /api/v1/social/trader/:address", () => {
    it("returns 503 when the database is unavailable", async () => {
      mockPool = null;
      const res = await request(app).get(`/api/v1/social/trader/${ADDR}`);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Database unavailable/);
    });

    it("returns 404 when the lead trader is not found", async () => {
      schemaReady();
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get(`/api/v1/social/trader/${ADDR}`);
      expect(res.status).toBe(404);
    });

    it("returns a full trader profile with open positions", async () => {
      schemaReady();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            address: ADDR.toLowerCase(),
            profit_fee_bps: 1000,
            metadata_uri: "ipfs://x",
            active_followers: 5,
            total_pnl: "1234",
            roi: "12.5",
            win_rate: "60",
            total_trades: "30",
          },
        ],
      });
      mockFetchUserPositions.mockResolvedValueOnce([
        {
          market: { id: "0xmarket", marketAddress: "0xmarket" },
          isLong: true,
          size: "1000",
          leverage: "10",
          entryPrice: "2000",
        },
      ]);
      const res = await request(app).get(`/api/v1/social/trader/${ADDR}`);
      expect(res.status).toBe(200);
      expect(res.body.address).toBe(ADDR.toLowerCase());
      expect(res.body.roi).toBe(12.5);
      expect(res.body.openPositions).toHaveLength(1);
      expect(res.body.openPositions[0].market).toBe("0xmarket");
    });

    it("returns 501 when the copy-trading schema is missing", async () => {
      schemaMissing();
      const res = await request(app).get(`/api/v1/social/trader/${ADDR}`);
      expect(res.status).toBe(501);
    });

    it("returns 500 on an unexpected error", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce(new Error("boom"));
      const res = await request(app).get(`/api/v1/social/trader/${ADDR}`);
      expect(res.status).toBe(500);
    });

    it("returns 501 when the schema check query itself throws", async () => {
      // isCopySchemaReady swallows the error and reports the schema as absent.
      mockQuery.mockRejectedValueOnce(new Error("connection reset"));
      const res = await request(app).get(`/api/v1/social/trader/${ADDR}`);
      expect(res.status).toBe(501);
    });

    it("returns 501 when the data query fails with a missing-schema PG code", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce({ code: "42P01" });
      const res = await request(app).get(`/api/v1/social/trader/${ADDR}`);
      expect(res.status).toBe(501);
    });
  });

  describe("GET /api/v1/social/copier/:address/following", () => {
    it("returns 503 when db unavailable", async () => {
      mockPool = null;
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/following`);
      expect(res.status).toBe(503);
    });

    it("maps copy relationships to a following list", async () => {
      schemaReady();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            lead_trader_address: "0xlead",
            max_allocation: "100",
            max_leverage: 5,
            started_at: "2024-01-01",
            copied_pnl: "42",
          },
        ],
      });
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/following`);
      expect(res.status).toBe(200);
      expect(res.body.following).toHaveLength(1);
      expect(res.body.following[0].address).toBe("0xlead");
    });

    it("returns 501 when schema missing", async () => {
      schemaMissing();
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/following`);
      expect(res.status).toBe(501);
    });

    it("returns 500 on unexpected error", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce(new Error("boom"));
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/following`);
      expect(res.status).toBe(500);
    });

    it("returns 501 when the data query fails with a missing-schema PG code", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce({ code: "42703" });
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/following`);
      expect(res.status).toBe(501);
    });
  });

  describe("GET /api/v1/social/copier/:address/pnl", () => {
    it("returns 503 when db unavailable", async () => {
      mockPool = null;
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/pnl`);
      expect(res.status).toBe(503);
    });

    it("aggregates PnL across lead traders", async () => {
      schemaReady();
      mockQuery.mockResolvedValueOnce({
        rows: [
          { lead_trader_address: "0xlead1", total_pnl: "100" },
          { lead_trader_address: "0xlead2", total_pnl: "200" },
        ],
      });
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/pnl`);
      expect(res.status).toBe(200);
      expect(res.body.totalCopiedPnl).toBe("300");
      expect(res.body.pnlByTrader["0xlead1"]).toBe("100");
    });

    it("handles null pnl rows", async () => {
      schemaReady();
      mockQuery.mockResolvedValueOnce({
        rows: [{ lead_trader_address: "0xlead1", total_pnl: null }],
      });
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/pnl`);
      expect(res.status).toBe(200);
      expect(res.body.totalCopiedPnl).toBe("0");
    });

    it("returns 501 when schema missing", async () => {
      schemaMissing();
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/pnl`);
      expect(res.status).toBe(501);
    });

    it("returns 500 on unexpected error", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce(new Error("boom"));
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/pnl`);
      expect(res.status).toBe(500);
    });

    it("returns 501 when the data query fails with a missing-schema PG code", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce({ code: "42883" });
      const res = await request(app).get(`/api/v1/social/copier/${ADDR}/pnl`);
      expect(res.status).toBe(501);
    });
  });

  describe("GET /api/v1/social/top-traders", () => {
    it("returns 503 when db unavailable", async () => {
      mockPool = null;
      const res = await request(app).get(`/api/v1/social/top-traders`);
      expect(res.status).toBe(503);
    });

    it("returns mapped traders", async () => {
      schemaReady();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            address: "0xlead",
            profit_fee_bps: 1000,
            metadata_uri: "ipfs://x",
            active_followers: 2,
            total_pnl: "10",
            roi: "5",
            win_rate: "50",
            total_trades: "12",
          },
        ],
      });
      const res = await request(app).get(`/api/v1/social/top-traders`);
      expect(res.status).toBe(200);
      expect(res.body.traders).toHaveLength(1);
      expect(res.body.traders[0].winRate).toBe(50);
    });

    it("returns an empty set when schema missing", async () => {
      schemaMissing();
      const res = await request(app).get(`/api/v1/social/top-traders`);
      expect(res.status).toBe(200);
      expect(res.body.traders).toEqual([]);
    });

    it("returns 500 on unexpected error", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce(new Error("boom"));
      const res = await request(app).get(`/api/v1/social/top-traders`);
      expect(res.status).toBe(500);
    });

    it("returns an empty set when the data query fails with a missing-schema PG code", async () => {
      schemaReady();
      mockQuery.mockRejectedValueOnce({ code: "3F000" });
      const res = await request(app).get(`/api/v1/social/top-traders`);
      expect(res.status).toBe(200);
      expect(res.body.traders).toEqual([]);
    });
  });

  describe("POST /api/v1/social/refresh", () => {
    it("refreshes the copy engine when present", async () => {
      const res = await request(app).post(`/api/v1/social/refresh`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("succeeds even when no engine is configured", async () => {
      mockEngine = null;
      const res = await request(app).post(`/api/v1/social/refresh`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 500 when refresh throws", async () => {
      mockRefresh.mockRejectedValueOnce(new Error("boom"));
      const res = await request(app).post(`/api/v1/social/refresh`);
      expect(res.status).toBe(500);
    });
  });
});
