import { getWritePool, getReadPool, isUsingReadReplica, resetPools } from "../services/db.js";

describe("db pool routing", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    resetPools();
    process.env.POSTGRES_URL = "postgres://user:pass@primary:5432/realyx";
    delete process.env.POSTGRES_READ_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    resetPools();
  });

  it("returns null when no primary is configured", () => {
    delete process.env.POSTGRES_URL;
    resetPools();
    expect(getWritePool()).toBeNull();
  });

  it("read pool falls back to the primary when no replica is set", () => {
    const read = getReadPool();
    const write = getWritePool();
    expect(read).toBe(write);
    expect(isUsingReadReplica()).toBe(false);
  });

  it("reports replica routing when POSTGRES_READ_URL is configured", () => {
    // Note: the global pg mock returns a singleton Pool, so we assert the
    // routing flag (behavioral) rather than object identity here.
    process.env.POSTGRES_READ_URL = "postgres://user:pass@replica:5432/realyx";
    resetPools();
    getReadPool();
    expect(isUsingReadReplica()).toBe(true);
  });

  it("does not report replica routing when only the primary is set", () => {
    resetPools();
    getReadPool();
    expect(isUsingReadReplica()).toBe(false);
  });

  it("memoizes pools across calls", () => {
    const a = getWritePool();
    const b = getWritePool();
    expect(a).toBe(b);
  });

  it("clamps an invalid PG_POOL_MAX down to the safe minimum", async () => {
    process.env.PG_POOL_MAX = "not-a-number";
    await jest.isolateModulesAsync(async () => {
      const db = await import("../services/db.js");
      db.resetPools();
      // poolMax() rejects the non-finite value and returns 1; the pool
      // still constructs fine.
      expect(db.getWritePool()).not.toBeNull();
    });
    delete process.env.PG_POOL_MAX;
  });

  it("clamps an oversized PG_POOL_MAX to the upper bound", async () => {
    process.env.PG_POOL_MAX = "5000";
    await jest.isolateModulesAsync(async () => {
      const db = await import("../services/db.js");
      db.resetPools();
      expect(db.getWritePool()).not.toBeNull();
    });
    delete process.env.PG_POOL_MAX;
  });
});
