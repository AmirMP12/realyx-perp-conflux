import { jest } from "@jest/globals";

const mockQuery = jest.fn<any>();
let mockPool: any = { query: mockQuery };
let withProviderImpl: any = async (cb: any) => cb({});

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

jest.mock("../services/db.js", () => ({
  __esModule: true,
  getReadPool: () => mockPool,
}));

jest.mock("../services/rpcPool.js", () => ({
  __esModule: true,
  withProvider: (cb: any) => withProviderImpl(cb),
}));

// Run the factory eagerly so we exercise buildYieldPayload directly each call.
jest.mock("../services/cache.js", () => ({
  __esModule: true,
  cacheGetOrSet: (_key: string, _ttl: number, fn: any) => fn(),
  __resetCacheForTests: () => {},
}));

import request from "supertest";
import { app } from "../app.js";

describe("Vault yield route", () => {
  const prevPg = process.env.POSTGRES_URL;
  const prevVault = process.env.VAULT_CORE_ADDRESS;
  const prevDeployed = process.env.DEPLOYED_VAULT_CORE;

  beforeEach(() => {
    mockQuery.mockReset();
    mockPool = { query: mockQuery };
    withProviderImpl = async (cb: any) => cb({});
    process.env.POSTGRES_URL = "postgres://test";
    delete process.env.VAULT_CORE_ADDRESS;
    delete process.env.DEPLOYED_VAULT_CORE;
  });

  afterAll(() => {
    if (prevPg === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevPg;
    if (prevVault === undefined) delete process.env.VAULT_CORE_ADDRESS; else process.env.VAULT_CORE_ADDRESS = prevVault;
    if (prevDeployed === undefined) delete process.env.DEPLOYED_VAULT_CORE; else process.env.DEPLOYED_VAULT_CORE = prevDeployed;
  });

  it("returns zeroed sources when there are no events and no vault address", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/vault/yield");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tvl).toBe(0);
    expect(res.body.data.sources).toHaveLength(3);
    expect(res.body.data.estimated).toBe(true);
  });

  it("computes per-day yield history from indexed rows with a live TVL", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => 1_000_000; // fetchTvl resolves to this directly
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          date: "2024-06-01",
          open_notional: "100000",
          close_notional: "50000",
          liquidated_margin: "2000",
        },
        {
          date: "2024-06-02",
          open_notional: "0",
          close_notional: "0",
          liquidated_margin: "0",
        },
      ],
    });
    const res = await request(app).get("/api/v1/vault/yield");
    expect(res.status).toBe(200);
    expect(res.body.data.tvl).toBe(1_000_000);
    expect(res.body.data.history.length).toBe(2);
    expect(res.body.data.totalApr).toBeGreaterThan(0);
  });

  it("degrades gracefully when the yield query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("query failed"));
    const res = await request(app).get("/api/vault/yield");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.history).toEqual([]);
  });

  it("skips the query when no read pool is available", async () => {
    mockPool = null;
    const res = await request(app).get("/api/vault/yield");
    expect(res.status).toBe(200);
    expect(res.body.data.sources).toHaveLength(3);
  });

  it("returns a fallback payload when fetchTvl rejects", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => { throw new Error("rpc down"); };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/vault/yield");
    expect(res.status).toBe(200);
    // fetchTvl swallows the error → tvl 0, still a valid payload.
    expect(res.body.data.tvl).toBe(0);
  });
});
