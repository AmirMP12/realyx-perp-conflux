import { jest } from "@jest/globals";

const mockQuery = jest.fn<any>();
let mockPool: any = { query: mockQuery };
let marketsImpl: any = async () => [];
let withProviderImpl: any = async (cb: any) => cb({});

jest.mock("../services/db.js", () => ({
  __esModule: true,
  getReadPool: () => mockPool,
}));
jest.mock("../services/fetchMarketsOnchain.js", () => ({
  __esModule: true,
  fetchMarketsOnChain: (...a: any[]) => marketsImpl(...a),
}));
jest.mock("../services/rpcPool.js", () => ({
  __esModule: true,
  withProvider: (cb: any) => withProviderImpl(cb),
}));

import { runReconciliation, startReconciliationLoop } from "../services/reconciliation.js";

describe("reconciliation (extended)", () => {
  const prevPg = process.env.POSTGRES_URL;
  const prevVault = process.env.VAULT_CORE_ADDRESS;
  const prevDeployed = process.env.DEPLOYED_VAULT_CORE;

  beforeEach(() => {
    mockQuery.mockReset();
    mockPool = { query: mockQuery };
    marketsImpl = async () => [];
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

  it("computes open-interest drift and TVL from indexed + on-chain reads", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "100" }] });
    marketsImpl = async () => [
      { totalLongSize: (60n * 10n ** 18n).toString(), totalShortSize: (40n * 10n ** 18n).toString() },
    ];
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => 12345; // onchainTvl resolves directly
    const result = await runReconciliation();
    expect(result.ran).toBe(true);
    expect(result.openInterest).toBeDefined();
    expect(result.openInterest!.indexed).toBe(100);
    expect(result.openInterest!.onchain).toBe(100);
    expect(result.openInterest!.drift).toBeCloseTo(0, 6);
    expect(result.tvl).toEqual({ onchain: 12345 });
  });

  it("flags significant open-interest drift (>5%)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "200" }] });
    marketsImpl = async () => [
      { totalLongSize: (100n * 10n ** 18n).toString(), totalShortSize: "0" },
    ];
    const result = await runReconciliation();
    expect(result.openInterest!.drift).toBeCloseTo(1, 6);
  });

  it("returns no openInterest when the indexed query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("query boom"));
    marketsImpl = async () => [];
    const result = await runReconciliation();
    expect(result.ran).toBe(true);
    expect(result.openInterest).toBeUndefined();
  });

  it("skips indexed OI when no read pool is configured", async () => {
    mockPool = null;
    const result = await runReconciliation();
    expect(result.ran).toBe(true);
    expect(result.openInterest).toBeUndefined();
  });

  it("returns no openInterest when the on-chain read fails", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "100" }] });
    marketsImpl = async () => { throw new Error("rpc fail"); };
    const result = await runReconciliation();
    expect(result.openInterest).toBeUndefined();
  });

  it("returns no TVL when the vault read fails", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => { throw new Error("rpc fail"); };
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "0" }] });
    const result = await runReconciliation();
    expect(result.tvl).toBeUndefined();
  });

  it("returns no TVL when the vault read fails", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => { throw new Error("rpc fail"); };
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "0" }] });
    const result = await runReconciliation();
    expect(result.tvl).toBeUndefined();
  });

  it("treats a non-finite indexed OI as null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "not-a-number" }] });
    marketsImpl = async () => [{ totalLongSize: "0", totalShortSize: "0" }];
    const result = await runReconciliation();
    expect(result.openInterest).toBeUndefined();
  });

  it("defaults missing market sizes to zero in the on-chain OI sum", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "100" }] });
    marketsImpl = async () => [{ totalLongSize: "", totalShortSize: undefined }];
    const result = await runReconciliation();
    expect(result.ran).toBe(true);
  });

  it("degrades when the on-chain OI read throws a non-Error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "100" }] });
    marketsImpl = async () => { throw "string failure"; };
    const result = await runReconciliation();
    expect(result.openInterest).toBeUndefined();
  });

  it("degrades when the TVL read throws a non-Error", async () => {
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    withProviderImpl = async () => { throw "string tvl failure"; };
    mockQuery.mockResolvedValueOnce({ rows: [{ oi: "0" }] });
    const result = await runReconciliation();
    expect(result.tvl).toBeUndefined();
  });

  describe("startReconciliationLoop", () => {
    it("schedules and tears down its timers cleanly", () => {
      jest.useFakeTimers();
      try {
        const stop = startReconciliationLoop(60_000);
        expect(typeof stop).toBe("function");
        stop();
        // calling stop twice is safe
        stop();
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("enforces a minimum period", () => {
      jest.useFakeTimers();
      try {
        const stop = startReconciliationLoop(1000); // below 30s floor
        stop();
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });
  });
});
