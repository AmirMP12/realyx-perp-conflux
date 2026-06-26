import { jest } from "@jest/globals";

/**
 * Covers getReadPool's defensive fallback: when POSTGRES_READ_URL is set but the
 * replica pool can't be constructed, it must swallow the error and fall back to
 * the primary (writer) pool rather than throwing.
 */

jest.mock("pg", () => {
  const Pool = jest.fn((opts: any) => {
    if (typeof opts?.connectionString === "string" && opts.connectionString.includes("replica")) {
      throw new Error("replica pool construction failed");
    }
    return { query: jest.fn(), on: jest.fn(), end: jest.fn() };
  });
  return { __esModule: true, default: { Pool }, Pool };
});

import { getReadPool, getWritePool, isUsingReadReplica, resetPools } from "../services/db.js";

describe("db read-replica construction fallback", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    resetPools();
    process.env.POSTGRES_URL = "postgres://user:pass@primary:5432/realyx";
    process.env.POSTGRES_READ_URL = "postgres://user:pass@replica:5432/realyx";
  });

  afterEach(() => {
    process.env = { ...OLD };
    resetPools();
  });

  it("falls back to the primary pool when the replica pool throws on construction", () => {
    const read = getReadPool();
    const write = getWritePool();
    expect(read).toBe(write); // fell back to primary
    expect(isUsingReadReplica()).toBe(false);
  });
});
