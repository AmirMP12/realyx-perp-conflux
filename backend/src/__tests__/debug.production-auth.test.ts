import { jest } from "@jest/globals";

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

import request from "supertest";
import { app } from "../app.js";

function mockQuery(): jest.Mock {
  const pg = require("pg");
  const pool = new pg.default.Pool();
  return pool.query as jest.Mock;
}

describe("debug route production auth", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD, NODE_ENV: "production" };
  });

  afterAll(() => {
    process.env = OLD;
  });

  it("returns 404 in production when no DEBUG_SECRET is configured", async () => {
    delete process.env.DEBUG_SECRET;
    const res = await request(app).get("/api/debug");
    expect(res.status).toBe(404);
  });

  it("returns 401 in production when the secret does not match", async () => {
    process.env.DEBUG_SECRET = "s3cr3t";
    const res = await request(app).get("/api/debug").set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("authorizes via the ?key query param and reports DB status", async () => {
    process.env.DEBUG_SECRET = "s3cr3t";
    process.env.POSTGRES_URL = "postgres://test";
    const q = mockQuery();
    q.mockReset();
    q.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*) FROM position_events") && !sql.includes("block_time")) return Promise.resolve({ rows: [{ count: "10" }] });
      if (sql.includes("indexer_state")) return Promise.resolve({ rows: [{ last_synced_block: 5, last_synced_at: "2024-01-01" }] });
      if (sql.includes("referral_rebates")) return Promise.resolve({ rows: [{ count: "2", total: "100" }] });
      return Promise.resolve({ rows: [{ count: "1" }] });
    });
    const res = await request(app).get("/api/debug?key=s3cr3t");
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it("authorizes via the Authorization header", async () => {
    process.env.DEBUG_SECRET = "s3cr3t";
    process.env.POSTGRES_URL = "postgres://test";
    const res = await request(app).get("/api/debug").set("Authorization", "Bearer s3cr3t");
    expect(res.status).toBe(200);
  });
});
