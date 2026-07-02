import { jest } from "@jest/globals";

let pythImpl: any = async () => ({ a: 1, b: 2 });
let activeImpl: any = async () => new Set(["0xm"]);
let poolHealthImpl: any = () => [{ url: "u", failures: 0, cooling: false, state: "CLOSED" }];
let protocolImpl: any = async () => ({
  totalTrades: "5",
  totalVolumeUsd: "1000",
  volume24hUsd: "100",
  totalLiquidations: "0",
  totalPositionsOpened: "5",
  totalPositionsClosed: "4",
  totalFeesUsd: "10",
  tvl: "0",
});
let reconImpl: any = () => ({ ran: false });
let withProviderImpl: any = async (cb: any) => cb({});

// Configurable vault contract reads for readVault().
let vaultReads: any = {
  totalAssets: async () => 100n * 10n ** 18n,
  insuranceAssets: async () => 10n * 10n ** 6n,
  getInsuranceHealthRatio: async () => 12n * 10n ** 17n, // 1.2 → 120%
  isInsuranceHealthy: async () => true,
  getAvailableLiquidity: async () => 50n * 10n ** 6n,
};

jest.mock("ethers", () => ({
  __esModule: true,
  ethers: {
    Contract: jest.fn(() => ({
      totalAssets: () => vaultReads.totalAssets(),
      insuranceAssets: () => vaultReads.insuranceAssets(),
      getInsuranceHealthRatio: () => vaultReads.getInsuranceHealthRatio(),
      isInsuranceHealthy: () => vaultReads.isInsuranceHealthy(),
      getAvailableLiquidity: () => vaultReads.getAvailableLiquidity(),
    })),
  },
}));

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

jest.mock("../services/pyth.js", () => ({
  __esModule: true,
  fetchPythPrices: (...a: any[]) => pythImpl(...a),
}));
jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: (...a: any[]) => activeImpl(...a),
}));
jest.mock("../services/rpcPool.js", () => ({
  __esModule: true,
  getPoolHealth: (...a: any[]) => poolHealthImpl(...a),
  withProvider: (cb: any) => withProviderImpl(cb),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchProtocol: (...a: any[]) => protocolImpl(...a),
  getPool: () => null,
}));
jest.mock("../services/reconciliation.js", () => ({
  __esModule: true,
  getLastReconciliation: (...a: any[]) => reconImpl(...a),
  startReconciliationLoop: () => () => {},
}));
let cacheImpl: any = (_k: string, _t: number, fn: any) => fn();
jest.mock("../services/cache.js", () => ({
  __esModule: true,
  cacheGetOrSet: (k: string, t: number, fn: any) => cacheImpl(k, t, fn),
  __resetCacheForTests: () => {},
}));

import request from "supertest";
import { app } from "../app.js";

describe("Status route", () => {
  const prevVault = process.env.VAULT_CORE_ADDRESS;
  const prevDeployed = process.env.DEPLOYED_VAULT_CORE;

  beforeEach(() => {
    pythImpl = async () => ({ a: 1, b: 2 });
    activeImpl = async () => new Set(["0xm"]);
    poolHealthImpl = () => [{ url: "u", failures: 0, cooling: false, state: "CLOSED" }];
    protocolImpl = async () => ({
      totalTrades: "5",
      totalVolumeUsd: "1000",
      volume24hUsd: "100",
      totalLiquidations: "0",
      totalPositionsOpened: "5",
      totalPositionsClosed: "4",
      totalFeesUsd: "10",
      tvl: "0",
    });
    reconImpl = () => ({ ran: false });
    withProviderImpl = async (cb: any) => cb({});
    cacheImpl = (_k: string, _t: number, fn: any) => fn();
    vaultReads = {
      totalAssets: async () => 100n * 10n ** 18n,
      insuranceAssets: async () => 10n * 10n ** 6n,
      getInsuranceHealthRatio: async () => 12n * 10n ** 17n,
      isInsuranceHealthy: async () => true,
      getAvailableLiquidity: async () => 50n * 10n ** 6n,
    };
    delete process.env.VAULT_CORE_ADDRESS;
    delete process.env.DEPLOYED_VAULT_CORE;
  });

  afterAll(() => {
    if (prevVault === undefined) delete process.env.VAULT_CORE_ADDRESS;
    else process.env.VAULT_CORE_ADDRESS = prevVault;
    if (prevDeployed === undefined) delete process.env.DEPLOYED_VAULT_CORE;
    else process.env.DEPLOYED_VAULT_CORE = prevDeployed;
  });

  it("reports operational status when all components are healthy", async () => {
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("operational");
    expect(res.body.data.components.length).toBeGreaterThanOrEqual(4);
    expect(typeof res.body.data.uptimeSeconds).toBe("number");
  });

  it("marks oracle degraded when no feeds are returned", async () => {
    pythImpl = async () => ({});
    const res = await request(app).get("/api/status");
    const oracle = res.body.data.components.find((c: any) => c.key === "oracle");
    expect(oracle.status).toBe("degraded");
  });

  it("marks oracle down when pyth throws", async () => {
    pythImpl = async () => { throw new Error("pyth fail"); };
    const res = await request(app).get("/api/status");
    const oracle = res.body.data.components.find((c: any) => c.key === "oracle");
    expect(oracle.status).toBe("down");
  });

  it("marks rpc down when all endpoints are cooling", async () => {
    poolHealthImpl = () => [{ url: "u", failures: 5, cooling: true, state: "OPEN" }];
    const res = await request(app).get("/api/status");
    const rpc = res.body.data.components.find((c: any) => c.key === "rpc");
    expect(rpc.status).toBe("down");
    expect(res.body.data.status).toBe("down");
  });

  it("marks rpc degraded when some endpoints are cooling", async () => {
    poolHealthImpl = () => [
      { url: "u1", failures: 0, cooling: false, state: "CLOSED" },
      { url: "u2", failures: 5, cooling: true, state: "OPEN" },
    ];
    const res = await request(app).get("/api/status");
    const rpc = res.body.data.components.find((c: any) => c.key === "rpc");
    expect(rpc.status).toBe("degraded");
  });

  it("marks rpc down when activeMarkets throws", async () => {
    activeImpl = async () => { throw new Error("rpc fail"); };
    const res = await request(app).get("/api/status");
    const rpc = res.body.data.components.find((c: any) => c.key === "rpc");
    expect(rpc.status).toBe("down");
  });

  it("marks indexer degraded when fetchProtocol throws", async () => {
    protocolImpl = async () => { throw new Error("indexer fail"); };
    const res = await request(app).get("/api/status");
    const idx = res.body.data.components.find((c: any) => c.key === "indexer");
    expect(idx.status).toBe("degraded");
  });

  it("reads the vault when an address is configured", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    const res = await request(app).get("/api/status");
    const vault = res.body.data.components.find((c: any) => c.key === "vault");
    expect(vault).toBeDefined();
    expect(vault.status).toBe("operational");
    expect(res.body.data.vault.tvl).toBe(100);
    expect(res.body.data.vault.insuranceFund).toBe(10);
    expect(res.body.data.vault.solvencyRatio).toBeCloseTo(2.2);
  });

  it("marks vault degraded when readVault throws", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => { throw new Error("rpc down"); };
    const res = await request(app).get("/api/status");
    const vault = res.body.data.components.find((c: any) => c.key === "vault");
    expect(vault.status).toBe("degraded");
  });

  it("adds a data-quality component with high drift => down", async () => {
    reconImpl = () => ({ ran: true, openInterest: { drift: 0.2 } });
    const res = await request(app).get("/api/status");
    const dq = res.body.data.components.find((c: any) => c.key === "data_quality");
    expect(dq.status).toBe("down");
  });

  it("adds a data-quality component with moderate drift => degraded", async () => {
    reconImpl = () => ({ ran: true, openInterest: { drift: 0.1 } });
    const res = await request(app).get("/api/status");
    const dq = res.body.data.components.find((c: any) => c.key === "data_quality");
    expect(dq.status).toBe("degraded");
  });

  it("adds a data-quality component with low drift => operational", async () => {
    reconImpl = () => ({ ran: true, openInterest: { drift: 0.01 } });
    const res = await request(app).get("/api/status");
    const dq = res.body.data.components.find((c: any) => c.key === "data_quality");
    expect(dq.status).toBe("operational");
  });

  it("returns 503 when building the status payload fails", async () => {
    cacheImpl = async () => { throw new Error("status build failed"); };
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/status build failed/);
  });

  it("defaults each vault field when the individual contract calls reject", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    vaultReads = {
      totalAssets: async () => { throw new Error("revert"); },
      insuranceAssets: async () => { throw new Error("revert"); },
      getInsuranceHealthRatio: async () => { throw new Error("revert"); },
      isInsuranceHealthy: async () => { throw new Error("revert"); },
      getAvailableLiquidity: async () => { throw new Error("revert"); },
    };
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body.data.vault.tvl).toBe(0);
    expect(res.body.data.vault.insuranceHealthy).toBe(false);
  });

  it("returns zeroed vault data when no vault address is configured", async () => {
    delete process.env.VAULT_CORE_ADDRESS;
    delete process.env.DEPLOYED_VAULT_CORE;
    const res = await request(app).get("/api/status");
    expect(res.body.data.vault.tvl).toBe(0);
    expect(res.body.data.vault.solvencyRatio).toBeNull();
    const vault = res.body.data.components.find((c: any) => c.key === "vault");
    expect(vault.status).toBe("operational");
    expect(vault.detail).toBe("fully backed");
  });

  it("handles a null pyth result, empty rpc pool and missing active set", async () => {
    pythImpl = async () => null; // prices || {}
    poolHealthImpl = () => []; // pool.length || 1
    activeImpl = async () => undefined; // active?.size ?? 0
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    const oracle = res.body.data.components.find((c: any) => c.key === "oracle");
    expect(oracle.status).toBe("degraded");
    const rpc = res.body.data.components.find((c: any) => c.key === "rpc");
    expect(rpc.status).toBe("down");
  });

  it("falls back to generic detail text when components throw non-Error values", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    pythImpl = async () => { throw "pyth string"; };
    activeImpl = async () => { throw "rpc string"; };
    protocolImpl = async () => { throw "indexer string"; };
    withProviderImpl = async () => { throw "vault string"; };
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    const oracle = res.body.data.components.find((c: any) => c.key === "oracle");
    expect(oracle.detail).toBe("error");
    const vault = res.body.data.components.find((c: any) => c.key === "vault");
    expect(vault.detail).toBe("error");
  });

  it("uses the generic message when the cache layer throws a non-Error", async () => {
    cacheImpl = async () => { throw "boom string"; };
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Failed to build status");
  });
});
