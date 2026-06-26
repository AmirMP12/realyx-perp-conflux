import { jest } from "@jest/globals";

const mockQuery = jest.fn<any>();
let mockPool: any = { query: mockQuery };
let withProviderImpl: any = async (cb: any) => cb({});
let cacheImpl: any = (_k: string, _t: number, fn: any) => fn();
let totalAssetsImpl: any = async () => 1000n * 10n ** 18n;

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
jest.mock("../services/cache.js", () => ({
  __esModule: true,
  cacheGetOrSet: (k: string, t: number, fn: any) => cacheImpl(k, t, fn),
  __resetCacheForTests: () => {},
}));
jest.mock("ethers", () => {
  const actual: any = jest.requireActual("ethers");
  return {
    __esModule: true,
    ethers: {
      ...actual.ethers,
      Contract: jest.fn(() => ({ totalAssets: () => totalAssetsImpl() })),
    },
  };
});

import request from "supertest";
import { app } from "../app.js";

describe("vault yield route", () => {
  const prevPg = process.env.POSTGRES_URL;
  const prevVault = process.env.VAULT_CORE_ADDRESS;
  const prevDeployed = process.env.DEPLOYED_VAULT_CORE;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockPool = { query: mockQuery };
    withProviderImpl = async (cb: any) => cb({});
    cacheImpl = (_k: string, _t: number, fn: any) => fn();
    totalAssetsImpl = async () => 1000n * 10n ** 18n;
    process.env.POSTGRES_URL = "postgres://test";
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    delete process.env.DEPLOYED_VAULT_CORE;
  });

  afterAll(() => {
    if (prevPg === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = prevPg;
    if (prevVault === undefined) delete process.env.VAULT_CORE_ADDRESS; else process.env.VAULT_CORE_ADDRESS = prevVault;
    if (prevDeployed === undefined) delete process.env.DEPLOYED_VAULT_CORE; else process.env.DEPLOYED_VAULT_CORE = prevDeployed;
  });

  it("reads live TVL from the vault contract (provider callback executed)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/vault/yield");
    expect(res.status).toBe(200);
    expect(res.body.data.tvl).toBe(1000);
  });

  it("returns a fallback payload when the cache layer itself throws", async () => {
    cacheImpl = async () => { throw new Error("cache exploded"); };
    const res = await request(app).get("/api/vault/yield");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.data.totalApr).toBe(0);
    expect(res.body.data.sources).toEqual([]);
  });

  it("uses the generic message when the cache throws a non-Error", async () => {
    cacheImpl = async () => { throw "string boom"; };
    const res = await request(app).get("/api/vault/yield");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Failed to compute vault yield");
  });
});
