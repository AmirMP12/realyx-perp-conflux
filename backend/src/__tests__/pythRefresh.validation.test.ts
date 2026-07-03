import { jest } from "@jest/globals";
import request from "supertest";

const mockOracleAggregator = jest.fn<any>();
const mockPythAddr = jest.fn<any>();
const mockGetOracleConfig = jest.fn<any>();
const mockGetUpdateFee = jest.fn<any>();
const mockUpdatePriceFeeds = jest.fn<any>();
const mockWait = jest.fn<any>();

jest.mock("ethers", () => {
  const mProvider = jest.fn().mockImplementation(() => ({ getLogs: jest.fn() }));
  const mWallet = jest.fn().mockImplementation(() => ({}));
  const mContract = jest.fn().mockImplementation(() => ({
    oracleAggregator: (...a: any[]) => mockOracleAggregator(...a),
    pyth: (...a: any[]) => mockPythAddr(...a),
    getOracleConfig: (...a: any[]) => mockGetOracleConfig(...a),
    getUpdateFee: (...a: any[]) => mockGetUpdateFee(...a),
    updatePriceFeeds: (...a: any[]) => mockUpdatePriceFeeds(...a),
  }));

  const mEthers = {
    JsonRpcProvider: mProvider,
    Wallet: mWallet,
    Contract: mContract,
    isAddress: (s: string) =>
      typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s),
    ZeroHash:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
  return { ...mEthers, ethers: mEthers };
});

jest.mock("fs", () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn().mockReturnValue("{}"),
  },
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue("{}"),
}));

import fs from "fs";
import { app } from "../app.js";

const mockedFs = fs as jest.Mocked<typeof fs>;
const VALID_MARKET = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
const VALID_FEED_ID = "0x" + "f".repeat(64);
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const globalFetch = jest.fn<any>();
global.fetch = globalFetch;

describe("pythRefresh validation and configuration", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = "secret";
    process.env.PYTH_REFRESH_PRIVATE_KEY = "0x" + "1".repeat(64);
    process.env.TRADING_CORE_ADDRESS = "0x" + "a".repeat(40);
    delete process.env.DEPLOYED_TRADING_CORE;

    (mockedFs.existsSync as jest.Mock).mockReturnValue(false);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue("{}");

    mockOracleAggregator.mockResolvedValue("0x" + "b".repeat(40));
    mockPythAddr.mockResolvedValue("0x" + "c".repeat(40));
    mockGetOracleConfig.mockResolvedValue([VALID_FEED_ID, 0n, 0n, 0n]);
    mockGetUpdateFee.mockResolvedValue(0n);
    mockWait.mockResolvedValue({ hash: "0xtxhash" });
    mockUpdatePriceFeeds.mockResolvedValue({
      hash: "0xtxhash",
      wait: mockWait,
    });

    globalFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ binary: { data: ["0xvaa"] } }),
      text: async () => "ok",
    });
  });

  afterEach(() => {
    process.env = { ...OLD };
  });

  it("returns 401 when CRON_SECRET is set and Authorization header is missing", async () => {
    const res = await request(app).get(
      `/api/pyth-refresh?markets=${VALID_MARKET}`
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("returns 401 when CRON_SECRET is set and the token is wrong", async () => {
    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });

  it("passes through when no CRON_SECRET is configured (open endpoint)", async () => {
    delete process.env.CRON_SECRET;
    const res = await request(app).get(
      `/api/pyth-refresh?markets=${VALID_MARKET}`
    );
    expect(res.status).not.toBe(401);
  });

  it("returns 500 when KEEPER_PRIVATE_KEY is used instead of PYTH_REFRESH_PRIVATE_KEY", async () => {
    delete process.env.PYTH_REFRESH_PRIVATE_KEY;
    process.env.KEEPER_PRIVATE_KEY = "0x" + "2".repeat(64);
    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).not.toBe(500);
  });

  it("returns 500 when all private key env vars are absent", async () => {
    delete process.env.PYTH_REFRESH_PRIVATE_KEY;
    delete process.env.KEEPER_PRIVATE_KEY;
    delete process.env.PRIVATE_KEY;
    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/PYTH_REFRESH_PRIVATE_KEY/);
  });

  it("returns 500 when no trading core address is found (env + file missing)", async () => {
    delete process.env.TRADING_CORE_ADDRESS;
    delete process.env.DEPLOYED_TRADING_CORE;
    (mockedFs.existsSync as jest.Mock).mockReturnValue(false);

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/missing/);
  });

  it("loads trading core address from deployment JSON when env var is absent", async () => {
    delete process.env.TRADING_CORE_ADDRESS;
    delete process.env.DEPLOYED_TRADING_CORE;
    (mockedFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ contracts: { tradingCore: "0x" + "d".repeat(40) } })
    );
    mockGetOracleConfig.mockResolvedValue([ZERO_HASH, 0n, 0n, 0n]);

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("No Pyth feeds for given markets");
    expect(mockedFs.readFileSync).toHaveBeenCalled();
  });

  it("returns 500 when deployment JSON cannot be parsed", async () => {
    delete process.env.TRADING_CORE_ADDRESS;
    delete process.env.DEPLOYED_TRADING_CORE;
    (mockedFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue("INVALID_JSON{{{");

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(500);
  });

  it("returns 500 when deployment JSON has no tradingCore field", async () => {
    delete process.env.TRADING_CORE_ADDRESS;
    delete process.env.DEPLOYED_TRADING_CORE;
    (mockedFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ contracts: {} })
    );

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(500);
  });

  it("returns 400 when ?markets query param is absent", async () => {
    const res = await request(app)
      .get("/api/pyth-refresh")
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Query required/);
  });

  it("returns 400 for an invalid market address", async () => {
    const res = await request(app)
      .get("/api/pyth-refresh?markets=notanaddress")
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid market address/);
  });

  it("returns 200 with empty-feeds message when all feedIds are ZeroHash", async () => {
    mockGetOracleConfig.mockResolvedValue([ZERO_HASH, 0n, 0n, 0n]);

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBeNull();
    expect(res.body.message).toBe("No Pyth feeds for given markets");
  });

  it("deduplicates identical feed IDs across multiple markets", async () => {
    const MARKET2 = "0x" + "e".repeat(40);
    mockGetOracleConfig.mockResolvedValue([VALID_FEED_ID, 0n, 0n, 0n]);

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET},${MARKET2}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body.feedsUpdated).toBe(1);
  });

  it("returns 502 when Hermes returns empty binary data", async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ binary: { data: [] } }),
    });

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Hermes returned no binary update data");
  });

  it("returns 502 when Hermes returns binary.data with only falsy entries", async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ binary: { data: [null, "", undefined] } }),
    });

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(502);
  });

  it("prepends 0x to a Hermes data entry that lacks it", async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ binary: { data: ["deadbeef"] } }),
    });

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    const callArg = mockUpdatePriceFeeds.mock.calls[0]?.[0];
    expect(Array.isArray(callArg)).toBe(true);
    expect(callArg[0]).toBe("0xdeadbeef");
  });

  it("returns 500 when Hermes responds with a non-ok status", async () => {
    globalFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Hermes 503/);
  });

  it("uses tx.hash when receipt.hash is not present", async () => {
    mockWait.mockResolvedValue(null);
    mockUpdatePriceFeeds.mockResolvedValue({
      hash: "0xfallbackhash",
      wait: mockWait,
    });

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe("0xfallbackhash");
  });

  it("returns 500 with generic message when a non-Error value is thrown", async () => {
    mockOracleAggregator.mockImplementation(() => {
      throw "string error value";
    });

    const res = await request(app)
      .get(`/api/pyth-refresh?markets=${VALID_MARKET}`)
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("pyth-refresh failed");
  });
});
