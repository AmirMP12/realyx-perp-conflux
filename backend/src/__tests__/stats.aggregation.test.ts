import { jest } from "@jest/globals";

let protocolImpl: any = async () => ({ volume24hUsd: "0", totalVolumeUsd: "0", totalLiquidations: "0" });
let marketsImpl: any = async () => [];
let activeTradersImpl: any = async () => 0;
let metricsImpl: any = async () => [];
let activeImpl: any = async () => new Set<string>();
let withProviderImpl: any = async (cb: any) => cb({});
let cacheImpl: any = (_k: string, _t: number, fn: any) => fn();

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: async () => {},
  runSync: jest.fn(),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchProtocol: (...a: any[]) => protocolImpl(...a),
  fetchMarkets: (...a: any[]) => marketsImpl(...a),
  fetchActiveTraders24h: (...a: any[]) => activeTradersImpl(...a),
  fetchProtocolMetrics: (...a: any[]) => metricsImpl(...a),
}));
jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: (...a: any[]) => activeImpl(...a),
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
  return { __esModule: true, ethers: { ...actual.ethers, Contract: jest.fn(() => ({ totalAssets: async () => 1000n * 10n ** 18n })) } };
});

import request from "supertest";
import { app } from "../app.js";

const ADDR = "0x986a383f6de4a24dd3f524f0f93546229b58265f";

describe("stats routes", () => {
  const prevVault = process.env.VAULT_CORE_ADDRESS;
  const prevDeployed = process.env.DEPLOYED_VAULT_CORE;

  beforeEach(() => {
    protocolImpl = async () => ({ volume24hUsd: "0", totalVolumeUsd: "0", totalLiquidations: "0" });
    marketsImpl = async () => [];
    activeTradersImpl = async () => 0;
    metricsImpl = async () => [];
    activeImpl = async () => new Set<string>();
    withProviderImpl = async (cb: any) => cb({});
    cacheImpl = (_k: string, _t: number, fn: any) => fn();
    delete process.env.VAULT_CORE_ADDRESS;
    delete process.env.DEPLOYED_VAULT_CORE;
  });

  afterAll(() => {
    if (prevVault === undefined) delete process.env.VAULT_CORE_ADDRESS; else process.env.VAULT_CORE_ADDRESS = prevVault;
    if (prevDeployed === undefined) delete process.env.DEPLOYED_VAULT_CORE; else process.env.DEPLOYED_VAULT_CORE = prevDeployed;
  });

  it("falls back to cached TVL when the chain read throws", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => { throw new Error("rpc down"); };
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.data.tvl).toBe("0");
  });

  it("reads TVL from chain when a vault address is configured", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.data.tvl).toBe("1000.000000");
  });

  it("sums market volume when protocol volume is zero", async () => {
    marketsImpl = async () => [
      { marketAddress: ADDR, totalLongSize: (10n ** 18n).toString(), totalShortSize: "0", volume24h: "1500" },
    ];
    activeImpl = async () => new Set([ADDR.toLowerCase()]);
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.data.volume24h).toBe("1500.000000");
    expect(Number(res.body.data.totalOpenInterest)).toBeGreaterThan(0);
  });

  it("falls back to pre-filter market count when the active filter empties the list", async () => {
    marketsImpl = async () => [{ marketAddress: "0xnotactive", totalLongSize: "0", totalShortSize: "0" }];
    activeImpl = async () => new Set(["0xsomethingelse"]);
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.data.totalMarkets).toBe(1);
  });

  it("uses protocol volume directly when present", async () => {
    protocolImpl = async () => ({ volume24hUsd: "999", totalVolumeUsd: "5000", totalLiquidations: "3" });
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.data.volume24h).toBe("999.000000");
    expect(res.body.data.cumulativeVolumeUsd).toBe("5000.000000");
  });

  it("returns the error payload when building stats throws", async () => {
    cacheImpl = async () => { throw new Error("build fail"); };
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.data.totalMarkets).toBe(0);
  });

  it("uses the generic message when stats build throws a non-Error", async () => {
    cacheImpl = async () => { throw "string boom"; };
    const res = await request(app).get("/api/stats");
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Failed to fetch stats");
  });

  it("uses the generic message when history throws a non-Error", async () => {
    metricsImpl = async () => { throw "string boom"; };
    const res = await request(app).get("/api/stats/history");
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Failed to fetch stats history");
  });

  it("returns history data and handles history errors", async () => {
    metricsImpl = async () => [{ timestamp: "1713400000", volumeUsd: "1000000000000000000", tradesCount: "10", feesUsd: "0" }];
    const ok = await request(app).get("/api/stats/history");
    expect(ok.body.data).toHaveLength(1);

    metricsImpl = async () => { throw new Error("metrics fail"); };
    const err = await request(app).get("/api/stats/history");
    expect(err.body.success).toBe(false);
  });
});
