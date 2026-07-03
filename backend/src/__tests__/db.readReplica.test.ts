import { jest } from "@jest/globals";

const writeQueryMock = jest.fn<any>();
const readQueryMock = jest.fn<any>();

let poolCallCount = 0;

jest.mock("pg", () => {
  const Pool = jest.fn((opts: any) => {
    poolCallCount++;
    const isReplica =
      typeof opts?.connectionString === "string" &&
      opts.connectionString.includes("replica");
    return {
      query: isReplica ? readQueryMock : writeQueryMock,
      on: jest.fn(),
      end: jest.fn(),
    };
  });
  return { __esModule: true, default: { Pool }, Pool };
});

import {
  getEffectiveReadPool,
  getWritePool,
  getReadPool,
  resetPools,
} from "../services/db.js";

describe("getEffectiveReadPool stale replica detection", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    poolCallCount = 0;
    writeQueryMock.mockReset();
    readQueryMock.mockReset();
    resetPools();
    process.env.POSTGRES_URL = "postgres://user:pass@primary:5432/realyx";
    process.env.POSTGRES_READ_URL = "postgres://user:pass@replica:5432/realyx";
    writeQueryMock.mockResolvedValue({ rows: [{ n: 10 }] });
    readQueryMock.mockResolvedValue({ rows: [{ n: 10 }] });
  });

  afterEach(() => {
    process.env = { ...OLD };
    resetPools();
  });

  it("returns null when there is no write pool", async () => {
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_READ_URL;
    resetPools();
    const result = await getEffectiveReadPool();
    expect(result).toBeNull();
  });

  it("returns the write pool when no read replica is configured", async () => {
    delete process.env.POSTGRES_READ_URL;
    resetPools();
    const result = await getEffectiveReadPool();
    const write = getWritePool();
    expect(result).toBe(write);
    expect(writeQueryMock).not.toHaveBeenCalled();
  });

  it("falls back to write pool when replica is empty but primary has events", async () => {
    readQueryMock.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    writeQueryMock.mockResolvedValue({ rows: [{ n: 5 }] });
    const result = await getEffectiveReadPool();
    const write = getWritePool();
    expect(result).toBe(write);
  });

  it("uses the read pool when replica has events", async () => {
    readQueryMock.mockResolvedValue({ rows: [{ n: 5 }] });
    writeQueryMock.mockResolvedValue({ rows: [{ n: 5 }] });
    const result = await getEffectiveReadPool();
    const read = getReadPool();
    expect(result).toBe(read);
  });

  it("returns the write pool within the recheck window when stale fallback is active", async () => {
    readQueryMock.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    writeQueryMock.mockResolvedValue({ rows: [{ n: 5 }] });
    await getEffectiveReadPool();

    readQueryMock.mockClear();
    writeQueryMock.mockClear();
    const result = await getEffectiveReadPool();
    const write = getWritePool();
    expect(result).toBe(write);
    expect(readQueryMock).not.toHaveBeenCalled();
    expect(writeQueryMock).not.toHaveBeenCalled();
  });

  it("returns the read pool within the recheck window when healthy", async () => {
    readQueryMock.mockResolvedValue({ rows: [{ n: 5 }] });
    writeQueryMock.mockResolvedValue({ rows: [{ n: 5 }] });
    await getEffectiveReadPool();

    readQueryMock.mockClear();
    writeQueryMock.mockClear();
    const result = await getEffectiveReadPool();
    const read = getReadPool();
    expect(result).toBe(read);
    expect(readQueryMock).not.toHaveBeenCalled();
  });

  it("returns the read pool when the health-check query throws", async () => {
    readQueryMock.mockRejectedValueOnce(new Error("connection refused"));
    writeQueryMock.mockRejectedValueOnce(new Error("connection refused"));
    const result = await getEffectiveReadPool();
    const read = getReadPool();
    expect(result).toBe(read);
  });

  it("returns the read pool when write count is 0", async () => {
    readQueryMock.mockResolvedValue({ rows: [{ n: 0 }] });
    writeQueryMock.mockResolvedValue({ rows: [{ n: 0 }] });
    const result = await getEffectiveReadPool();
    const read = getReadPool();
    expect(result).toBe(read);
  });

  it("constructs pools with ssl disabled when POSTGRES_SSL=false", async () => {
    process.env.POSTGRES_SSL = "false";
    resetPools();
    const write = getWritePool();
    expect(write).not.toBeNull();
    delete process.env.POSTGRES_SSL;
  });

  it("constructs pools when URL parsing fails", async () => {
    process.env.POSTGRES_SSL = "false";
    process.env.POSTGRES_URL = "not-a-valid-url";
    resetPools();
    const write = getWritePool();
    expect(write).not.toBeNull();
    delete process.env.POSTGRES_SSL;
  });
});
