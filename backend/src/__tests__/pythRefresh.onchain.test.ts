import { jest } from "@jest/globals";

let oracleConfigImpl: any = async () => ["0x" + "f".repeat(64), 0, 0, 0];
let updateFeeImpl: any = async () => 100n;
let waitImpl: any = async () => ({ hash: "0xreceipt" });

jest.mock("ethers", () => {
  const actual: any = jest.requireActual("ethers");
  const Contract = jest.fn((addr: string, abi: any) => {
    const sig = JSON.stringify(abi);
    if (sig.includes("oracleAggregator")) return { oracleAggregator: async () => "0xoracle" };
    if (sig.includes("getOracleConfig")) return { pyth: async () => "0xpyth", getOracleConfig: (m: string) => oracleConfigImpl(m) };
    return { getUpdateFee: (d: any) => updateFeeImpl(d), updatePriceFeeds: async () => ({ hash: "0xtx", wait: () => waitImpl() }) };
  });
  return {
    __esModule: true,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: jest.fn(() => ({})),
      Wallet: jest.fn(() => ({ address: "0xwallet" })),
      Contract,
      isAddress: actual.ethers.isAddress,
      ZeroHash: actual.ethers.ZeroHash,
    },
  };
});

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

import request from "supertest";
import { app } from "../app.js";

const MARKET = "0x986a383f6de4a24dd3f524f0f93546229b58265f";

describe("pythRefresh route", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    oracleConfigImpl = async () => ["0x" + "f".repeat(64), 0, 0, 0];
    updateFeeImpl = async () => 100n;
    waitImpl = async () => ({ hash: "0xreceipt" });
    process.env = { ...OLD };
    process.env.PYTH_REFRESH_PRIVATE_KEY = "0x" + "1".repeat(64);
    process.env.TRADING_CORE_ADDRESS = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
    delete process.env.CRON_SECRET;
    (global as any).fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ binary: { data: ["aabbcc", "0xddeeff"] } }),
      text: async () => "",
    }));
  });

  afterAll(() => {
    process.env = OLD;
  });

  it("rejects unauthorized cron requests", async () => {
    process.env.CRON_SECRET = "secret";
    const res = await request(app).get(`/api/pyth-refresh?markets=${MARKET}`);
    expect(res.status).toBe(401);
  });

  it("returns 500 without a signer key", async () => {
    delete process.env.PYTH_REFRESH_PRIVATE_KEY;
    delete process.env.KEEPER_PRIVATE_KEY;
    delete process.env.PRIVATE_KEY;
    const res = await request(app).get(`/api/pyth-refresh?markets=${MARKET}`);
    expect(res.status).toBe(500);
  });

  it("returns 400 when no markets are provided", async () => {
    const res = await request(app).get(`/api/pyth-refresh`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid market address", async () => {
    const res = await request(app).get(`/api/pyth-refresh?markets=not-an-address`);
    expect(res.status).toBe(400);
  });

  it("returns success with no feeds when the oracle config is the zero hash", async () => {
    const { ethers } = jest.requireActual("ethers") as any;
    oracleConfigImpl = async () => [ethers.ZeroHash, 0, 0, 0];
    const res = await request(app).get(`/api/pyth-refresh?markets=${MARKET}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/No Pyth feeds/);
  });

  it("pushes Hermes update data on-chain and returns the tx hash", async () => {
    const res = await request(app).get(`/api/pyth-refresh?markets=${MARKET}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe("0xreceipt");
    expect(res.body.feedsUpdated).toBe(1);
  });

  it("returns 502 when Hermes returns no binary data", async () => {
    (global as any).fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, json: async () => ({ binary: { data: [] } }), text: async () => "",
    }));
    const res = await request(app).get(`/api/pyth-refresh?markets=${MARKET}`);
    expect(res.status).toBe(502);
  });

  it("returns 500 when an error is thrown mid-flight", async () => {
    updateFeeImpl = async () => { throw new Error("fee failed"); };
    const res = await request(app).get(`/api/pyth-refresh?markets=${MARKET}`);
    expect(res.status).toBe(500);
  });
});
