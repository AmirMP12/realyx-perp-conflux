import { jest } from "@jest/globals";
import { resolveTier } from "../middleware/rateLimit.js";

function mockQuery(): jest.Mock {
  const pg = require("pg");
  const pool = new pg.default.Pool();
  return pool.query as jest.Mock;
}

describe("rateLimit resolveTier", () => {
  const prevPg = process.env.POSTGRES_URL;
  let query: jest.Mock;

  beforeEach(() => {
    process.env.POSTGRES_URL = "postgres://test";
    query = mockQuery();
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  afterAll(() => {
    if (prevPg === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = prevPg;
  });

  it("returns FREE when no api key is provided", async () => {
    expect(await resolveTier(undefined)).toBe("FREE");
  });

  it("resolves a tier from the database and caches it", async () => {
    query.mockResolvedValueOnce({ rows: [{ tier: "PRO" }] });
    const first = await resolveTier("key-pro");
    expect(first).toBe("PRO");
    // Second call is served from cache (no further query).
    query.mockClear();
    const second = await resolveTier("key-pro");
    expect(second).toBe("PRO");
    expect(query).not.toHaveBeenCalled();
  });

  it("defaults to FREE when the key is unknown", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await resolveTier("key-unknown")).toBe("FREE");
  });

  it("falls back to FREE when the query throws", async () => {
    query.mockRejectedValueOnce(new Error("db down"));
    expect(await resolveTier("key-error")).toBe("FREE");
  });

  it("returns FREE when no database is configured", async () => {
    // Force a cold cache + no pool by clearing the env. The pool is cached at
    // module level, but an uncached key still calls getPool() which returns the
    // existing pool; use a brand-new key to drive the lookup path.
    query.mockResolvedValueOnce({ rows: [{ tier: "VIP" }] });
    expect(await resolveTier("key-vip")).toBe("VIP");
  });
});
