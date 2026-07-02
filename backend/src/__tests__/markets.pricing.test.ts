import { jest } from "@jest/globals";

let fetchMarketsImpl: any = async () => [];
let fetchProtocolImpl: any = async () => ({ volume24hUsd: "0", totalVolumeUsd: "0" });
let activeImpl: any = async () => new Set<string>();
let cgPricesImpl: any = async () => ({});
let cgIdImpl: any = (_addr: string) => null;
let cgHistoryImpl: any = async () => [];
let pythPricesImpl: any = async () => ({});
let pyth24hImpl: any = async () => 1.23;
let pythTvSymbolImpl: any = (_id: string) => null;
let pythHistoryImpl: any = async () => [];
let pythHermesImpl: any = async () => [];
let pythFeedIdImpl: any = (_id: string) => null;

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: async () => {},
  runSync: jest.fn(),
}));
jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchMarkets: (...a: any[]) => fetchMarketsImpl(...a),
  fetchProtocol: (...a: any[]) => fetchProtocolImpl(...a),
  fetchPerMarketVolume24hMap: async () => new Map(),
  fetchActiveTraders24h: async () => 0,
  getPool: () => null,
}));
jest.mock("../services/activeMarkets.js", () => ({
  __esModule: true,
  getActiveMarketAddresses: (...a: any[]) => activeImpl(...a),
}));
jest.mock("../services/coingecko.js", () => ({
  __esModule: true,
  fetchCoinGeckoPrices: (...a: any[]) => cgPricesImpl(...a),
  getCoinGeckoIdForMarket: (...a: any[]) => cgIdImpl(...a),
  fetchPriceHistory: (...a: any[]) => cgHistoryImpl(...a),
}));
jest.mock("../services/pyth.js", () => ({
  __esModule: true,
  fetchPythPrices: (...a: any[]) => pythPricesImpl(...a),
  fetchPyth24hChange: (...a: any[]) => pyth24hImpl(...a),
  getPythTvSymbol: (...a: any[]) => pythTvSymbolImpl(...a),
  fetchPythPriceHistory: (...a: any[]) => pythHistoryImpl(...a),
  fetchPythPriceHistoryHermes: (...a: any[]) => pythHermesImpl(...a),
  getPythFeedId: (...a: any[]) => pythFeedIdImpl(...a),
}));
jest.mock("../services/cache.js", () => ({
  __esModule: true,
  cacheGetOrSet: (_k: string, _t: number, fn: any) => fn(),
  cacheDel: async () => {},
  __resetCacheForTests: () => {},
}));

import request from "supertest";
import { app } from "../app.js";
import { clearMarketsCache } from "../routes/markets.js";

const ADDR = "0x986a383f6de4a24dd3f524f0f93546229b58265f"; // BTC in MARKET_META

describe("markets routes", () => {
  beforeEach(() => {
    fetchMarketsImpl = async () => [];
    fetchProtocolImpl = async () => ({ volume24hUsd: "0", totalVolumeUsd: "0" });
    activeImpl = async () => new Set<string>();
    cgPricesImpl = async () => ({});
    cgIdImpl = () => null;
    cgHistoryImpl = async () => [];
    pythPricesImpl = async () => ({});
    pyth24hImpl = async () => 1.23;
    pythTvSymbolImpl = () => null;
    pythHistoryImpl = async () => [];
    pythHermesImpl = async () => [];
    pythFeedIdImpl = () => null;
  });

  it("clearMarketsCache does not throw", () => {
    expect(() => clearMarketsCache()).not.toThrow();
  });

  it("builds enriched markets from on-chain data with an active filter", async () => {
    fetchMarketsImpl = async () => [
      {
        id: "1",
        marketAddress: ADDR,
        totalLongSize: (1000n * 10n ** 18n).toString(),
        totalShortSize: (500n * 10n ** 18n).toString(),
        totalLongCost: (2000n * 10n ** 30n).toString(),
        totalShortCost: (1000n * 10n ** 30n).toString(),
        fundingRate: (1n * 10n ** 15n).toString(),
        maxLeverage: "30",
        isActive: true,
        volume24h: "12345",
      },
      { id: "2", marketAddress: "0xnotactive", totalLongSize: "0", totalShortSize: "0", fundingRate: "0", isActive: true },
    ];
    activeImpl = async () => new Set([ADDR.toLowerCase()]);
    cgIdImpl = (a: string) => (a.toLowerCase() === ADDR.toLowerCase() ? "bitcoin" : null);
    cgPricesImpl = async () => ({ bitcoin: { price: 64000, change24h: 2.5 } });
    pythPricesImpl = async () => ({ [ADDR.toLowerCase()]: 64100 });
    const res = await request(app).get("/api/markets");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].marketAddress).toBe(ADDR);
    expect(res.body.data[0].change24h).toBe(1.23); // pyth change preferred
  });

  it("uses coingecko price/change when pyth is unavailable", async () => {
    fetchMarketsImpl = async () => [
      {
        id: "1",
        marketAddress: ADDR,
        totalLongSize: "0",
        totalShortSize: "0",
        totalLongCost: "0",
        totalShortCost: "0",
        fundingRate: "0",
        maxLeverage: "0",
        isActive: false,
      },
    ];
    activeImpl = async () => new Set<string>(); // no filter
    cgIdImpl = () => "bitcoin";
    cgPricesImpl = async () => ({ bitcoin: { price: 64000, change24h: 3.1 } });
    pythPricesImpl = async () => ({});
    pyth24hImpl = async () => { throw new Error("no pyth change"); };
    const res = await request(app).get("/api/markets");
    expect(res.status).toBe(200);
    expect(res.body.data[0].indexPrice).toBe("64000");
    expect(res.body.data[0].change24h).toBe(3.1);
    expect(res.body.data[0].isPaused).toBe(true);
  });

  it("falls back to enriched fallback markets when no on-chain markets exist", async () => {
    fetchMarketsImpl = async () => [];
    cgIdImpl = () => "bitcoin";
    cgPricesImpl = async () => ({ bitcoin: { price: 50000, change24h: 1 } });
    pythPricesImpl = async () => ({ [ADDR.toLowerCase()]: 50500 });
    const res = await request(app).get("/api/markets");
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("uses the fallback payload when the primary build throws", async () => {
    fetchMarketsImpl = async () => { throw new Error("indexer down"); };
    cgIdImpl = () => "bitcoin";
    cgPricesImpl = async () => ({ bitcoin: { price: 7, change24h: 0.5 } });
    pythPricesImpl = async () => ({ [ADDR.toLowerCase()]: 8 });
    const res = await request(app).get("/api/markets");
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
  });

  it("recovers when the price feeds reject for on-chain markets", async () => {
    fetchMarketsImpl = async () => [
      { id: "1", marketAddress: 12345 /* non-string addr */, totalLongSize: "0", totalShortSize: "0", totalLongCost: "0", totalShortCost: "0", fundingRate: "0", isActive: true },
    ];
    activeImpl = async () => new Set(["something"]); // size>0 → filter runs with non-string addr
    fetchProtocolImpl = async () => { throw new Error("protocol down"); };
    cgPricesImpl = async () => { throw new Error("cg down"); };
    pythPricesImpl = async () => { throw new Error("pyth down"); };
    const res = await request(app).get("/api/markets");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("recovers when the price feeds reject in the fallback payload", async () => {
    fetchMarketsImpl = async () => { throw new Error("primary boom"); };
    fetchProtocolImpl = async () => { throw new Error("protocol down"); };
    cgPricesImpl = async () => { throw new Error("cg down"); };
    pythPricesImpl = async () => { throw new Error("pyth down"); };
    pyth24hImpl = async () => { throw new Error("change down"); };
    const res = await request(app).get("/api/markets");
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
  });

  describe("GET /price-history/:marketId", () => {
    it("returns Pyth history when available", async () => {
      pythTvSymbolImpl = () => "BTCUSD";
      pythHistoryImpl = async () => [{ time: 1, value: 2 }];
      const res = await request(app).get(`/api/markets/price-history/${ADDR}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("returns empty Pyth history when source=pyth is forced", async () => {
      pythTvSymbolImpl = () => "BTCUSD";
      pythHistoryImpl = async () => [];
      const res = await request(app).get(`/api/markets/price-history/${ADDR}?source=pyth`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("falls back to Hermes history when the primary Pyth source is empty", async () => {
      pythTvSymbolImpl = () => "BTCUSD";
      pythHistoryImpl = async () => [];
      pythFeedIdImpl = () => "0xfeed";
      pythHermesImpl = async () => [{ time: 3, value: 4 }];
      const res = await request(app).get(`/api/markets/price-history/${ADDR}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("falls back to CoinGecko history when Pyth has nothing", async () => {
      pythTvSymbolImpl = () => null;
      cgIdImpl = () => "bitcoin";
      cgHistoryImpl = async () => [{ time: 5, value: 6 }];
      const res = await request(app).get(`/api/markets/price-history/${ADDR}?days=14`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("returns 404 when the market is unknown", async () => {
      pythTvSymbolImpl = () => null;
      cgIdImpl = () => null;
      const res = await request(app).get(`/api/markets/price-history/0xunknown`);
      expect(res.status).toBe(404);
    });

    it("handles errors gracefully", async () => {
      pythTvSymbolImpl = () => { throw new Error("boom"); };
      const res = await request(app).get(`/api/markets/price-history/${ADDR}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
    });
  });
});
