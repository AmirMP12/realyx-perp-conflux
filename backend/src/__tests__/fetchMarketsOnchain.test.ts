import { jest } from "@jest/globals";

let withProviderImpl: any = async (cb: any) => cb({});
let rpcUrlsImpl: any = () => ["https://rpc"];

jest.mock("../services/rpcPool.js", () => ({
  __esModule: true,
  withProvider: (cb: any) => withProviderImpl(cb),
  getRpcUrls: () => rpcUrlsImpl(),
}));

let contractImpl: any = {};
jest.mock("ethers", () => {
  const actual: any = jest.requireActual("ethers");
  return {
    __esModule: true,
    ethers: {
      ...actual.ethers,
      Contract: jest.fn(() => contractImpl),
    },
  };
});

import {
  _fetchMarketsOnChainImpl,
  calculateInstantFundingRate,
  toStr,
  getRpcUrls,
} from "../services/fetchMarketsOnchain.js";

describe("fetchMarketsOnchain", () => {
  const prevTc = process.env.TRADING_CORE_ADDRESS;
  const prevDtc = process.env.DEPLOYED_TRADING_CORE;

  beforeEach(() => {
    withProviderImpl = async (cb: any) => cb({});
    rpcUrlsImpl = () => ["https://rpc"];
    process.env.TRADING_CORE_ADDRESS = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
    delete process.env.DEPLOYED_TRADING_CORE;
  });

  afterAll(() => {
    if (prevTc === undefined) delete process.env.TRADING_CORE_ADDRESS; else process.env.TRADING_CORE_ADDRESS = prevTc;
    if (prevDtc === undefined) delete process.env.DEPLOYED_TRADING_CORE; else process.env.DEPLOYED_TRADING_CORE = prevDtc;
  });

  describe("calculateInstantFundingRate", () => {
    it("returns 0 for zero open interest", () => {
      expect(calculateInstantFundingRate(0n, 0n)).toBe(0n);
    });
    it("returns a positive rate when longs dominate", () => {
      expect(calculateInstantFundingRate(100n, 50n)).toBeGreaterThan(0n);
    });
    it("returns a negative rate when shorts dominate", () => {
      expect(calculateInstantFundingRate(50n, 100n)).toBeLessThan(0n);
    });
  });

  describe("toStr", () => {
    it("handles null, bigint, finite and non-finite numbers, and strings", () => {
      expect(toStr(null)).toBe("0");
      expect(toStr(5n)).toBe("5");
      expect(toStr(3.9)).toBe("3");
      expect(toStr(Infinity)).toBe("0");
      expect(toStr("hello")).toBe("hello");
    });
  });

  it("getRpcUrls delegates to the pool", () => {
    expect(getRpcUrls()).toEqual(["https://rpc"]);
  });

  it("returns [] when no trading core address is set", async () => {
    delete process.env.TRADING_CORE_ADDRESS;
    delete process.env.DEPLOYED_TRADING_CORE;
    expect(await _fetchMarketsOnChainImpl()).toEqual([]);
  });

  it("returns [] when the RPC pool has no urls", async () => {
    rpcUrlsImpl = () => [];
    expect(await _fetchMarketsOnChainImpl()).toEqual([]);
  });

  it("returns [] when activeMarketCount is not positive", async () => {
    contractImpl = { activeMarketCount: async () => 0n };
    expect(await _fetchMarketsOnChainImpl()).toEqual([]);
  });

  it("maps markets using named fields", async () => {
    contractImpl = {
      activeMarketCount: async () => 1n,
      activeMarketAt: async () => "0xMarketA",
      getMarketInfo: async () => ({
        totalLongSize: 100n,
        totalShortSize: 50n,
        maxLeverage: 30n,
        maxPositionSize: 1n,
        maxTotalExposure: 2n,
        totalLongCost: 3n,
        totalShortCost: 4n,
        isActive: true,
        isListed: true,
      }),
      getFundingState: async () => ({ cumulativeFunding: 7n, lastSettlement: 8n }),
    };
    const out = await _fetchMarketsOnChainImpl();
    expect(out).toHaveLength(1);
    expect(out[0].maxLeverage).toBe("30");
    expect(out[0].cumulativeFunding).toBe("7");
  });

  it("falls back to indexed access when named fields are undefined and handles null funding", async () => {
    const infoArray: any = [];
    infoArray[3] = 11n; infoArray[4] = 12n; infoArray[7] = 25n;
    infoArray[8] = 200n; infoArray[9] = 100n; infoArray[10] = 13n; infoArray[11] = 14n;
    infoArray[12] = true; infoArray[13] = false;
    contractImpl = {
      activeMarketCount: async () => 2n,
      activeMarketAt: async (i: number) => (i === 0 ? "0xMarketB" : 12345 /* non-string → skipped */),
      getMarketInfo: async (addr: any) => (addr === "0xMarketB" ? infoArray : null),
      getFundingState: async () => null,
    };
    const out = await _fetchMarketsOnChainImpl();
    expect(out).toHaveLength(1);
    expect(out[0].maxLeverage).toBe("25");
    expect(out[0].totalLongSize).toBe("200");
    expect(out[0].cumulativeFunding).toBe("0");
    expect(out[0].isListed).toBe(false);
  });

  it("skips a market whose getMarketInfo returned null", async () => {
    contractImpl = {
      activeMarketCount: async () => 1n,
      activeMarketAt: async () => "0xMarketC",
      getMarketInfo: async () => null,
      getFundingState: async () => null,
    };
    expect(await _fetchMarketsOnChainImpl()).toEqual([]);
  });

  it("returns [] when the provider call throws", async () => {
    withProviderImpl = async () => { throw new Error("all rpc down"); };
    expect(await _fetchMarketsOnChainImpl()).toEqual([]);
  });
});
