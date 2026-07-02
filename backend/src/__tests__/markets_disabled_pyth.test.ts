import { jest } from "@jest/globals";

let fetchMarketsImpl: any = async () => [];

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: async () => {},
  runSync: jest.fn(),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchMarkets: (...a: any[]) => fetchMarketsImpl(...a),
  fetchProtocol: async () => ({ volume24hUsd: "0", totalVolumeUsd: "0" }),
  fetchPerMarketVolume24hMap: async () => new Map(),
  fetchActiveTraders24h: async () => 0,
  getPool: () => null,
}));
jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: async () => new Set<string>(),
}));
jest.mock("../services/coingecko.js", () => ({
  __esModule: true,
  fetchCoinGeckoPrices: async () => ({}),
  getCoinGeckoIdForMarket: () => null,
  fetchPriceHistory: async () => [],
}));
jest.mock("../services/pyth.js", () => ({
  __esModule: true,
  fetchPythPrices: async () => ({}),
  fetchPyth24hChange: async () => 1,
  getPythTvSymbol: () => null,
  fetchPythPriceHistory: async () => [],
  fetchPythPriceHistoryHermes: async () => [],
  getPythFeedId: () => null,
}));
jest.mock("../services/cache.js", () => ({
  __esModule: true,
  cacheGetOrSet: (_k: string, _t: number, fn: any) => fn(),
  cacheDel: async () => {},
  __resetCacheForTests: () => {},
}));

import request from "supertest";

const ADDR = "0x986a383f6de4a24dd3f524f0f93546229b58265f";

describe("markets with ENABLE_PYTH_24H disabled", () => {
  const prev = process.env.ENABLE_PYTH_24H;

  afterEach(() => {
    if (prev === undefined) delete process.env.ENABLE_PYTH_24H;
    else process.env.ENABLE_PYTH_24H = prev;
  });

  it("builds markets without per-market pyth 24h change (non-empty + empty paths)", async () => {
    process.env.ENABLE_PYTH_24H = "false";
    await jest.isolateModulesAsync(async () => {
      const { app } = await import("../app.js");

      // non-empty on-chain markets → 24h change is omitted
      fetchMarketsImpl = async () => [
        { id: "1", marketAddress: ADDR, totalLongSize: "0", totalShortSize: "0", totalLongCost: "0", totalShortCost: "0", fundingRate: "0", maxLeverage: "30", isActive: true },
      ];
      const res1 = await request(app).get("/api/markets");
      expect(res1.status).toBe(200);
      expect(res1.body.data[0].change24h).toBeUndefined();

      // empty on-chain markets → fallback payload omits the 24h change
      fetchMarketsImpl = async () => [];
      const res2 = await request(app).get("/api/markets");
      expect(res2.status).toBe(200);
      expect(res2.body.fallback).toBe(true);
    });
  });
});
