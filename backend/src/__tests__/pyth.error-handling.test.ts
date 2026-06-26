import { jest } from "@jest/globals";

/**
 * Tests pyth.ts error/guard paths. Each test re-imports the
 * module fresh so the in-module price/change caches never leak between cases.
 */
function setFetch(impl: (url: string) => any) {
  (global as any).fetch = jest.fn((url: any) => Promise.resolve(impl(String(url))));
}

async function freshPyth() {
  let mod: any;
  await jest.isolateModulesAsync(async () => {
    mod = await import("../services/pyth.js");
  });
  return mod;
}

const okJson = (data: any) => ({ ok: true, status: 200, json: async () => data });
const notOk = () => ({ ok: false, status: 500, json: async () => ({}) });

const BTC = "0x986a383f6de4a24dd3f524f0f93546229b58265f";

describe("pyth error handling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips non-finite prices from Hermes", async () => {
    setFetch((url) => {
      if (url.includes("updates/price/latest")) {
        const ids = [...url.matchAll(/ids\[\]=([0-9a-fx]+)/g)].map((m) => m[1]);
        return okJson({ parsed: ids.map((id) => ({ id, price: { price: "not-a-number", expo: -8 } })) });
      }
      return okJson({});
    });
    const pyth = await freshPyth();
    const prices = await pyth.fetchPythPrices();
    expect(Object.keys(prices)).toHaveLength(0); // all skipped (norm = 0)
  });

  it("returns the (empty) cache when Hermes responds non-ok", async () => {
    setFetch(() => notOk());
    const pyth = await freshPyth();
    expect(await pyth.fetchPythPrices()).toEqual({});
  });

  it("returns the cache when the Hermes fetch throws", async () => {
    (global as any).fetch = jest.fn(() => Promise.reject(new Error("network")));
    const pyth = await freshPyth();
    expect(await pyth.fetchPythPrices()).toEqual({});
  });

  it("getPythTvSymbol / getPythFeedId return null/undefined for unknown markets", async () => {
    const pyth = await freshPyth();
    expect(pyth.getPythTvSymbol("0xunknown")).toBeNull();
    expect(pyth.getPythFeedId("0xunknown")).toBeUndefined();
  });

  it("fetchPyth24hChange returns undefined for an unknown market", async () => {
    const pyth = await freshPyth();
    expect(await pyth.fetchPyth24hChange("0xunknown")).toBeUndefined();
  });

  it("fetchPyth24hChange returns undefined when there is no current price", async () => {
    setFetch(() => notOk()); // prices empty, history empty
    const pyth = await freshPyth();
    expect(await pyth.fetchPyth24hChange(BTC)).toBeUndefined();
  });

  it("fetchPyth24hChange computes a change from current vs ~24h-ago", async () => {
    const dayAgo = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
    setFetch((url) => {
      if (url.includes("updates/price/latest")) {
        const ids = [...url.matchAll(/ids\[\]=([0-9a-fx]+)/g)].map((m) => m[1]);
        return okJson({ parsed: ids.map((id) => ({ id, price: { price: "110", expo: 0 } })) });
      }
      if (url.includes("shims/tradingview/history")) {
        return okJson({ s: "ok", t: [dayAgo, dayAgo + 3600], c: [100, 105] });
      }
      return okJson({});
    });
    const pyth = await freshPyth();
    const change = await pyth.fetchPyth24hChange(BTC);
    expect(typeof change).toBe("number");
    expect(change).toBeCloseTo(10, 0); // (110-100)/100*100
  });

  it("fetchPythPriceHistory returns [] for an unknown market and on non-ok / bad status", async () => {
    const pyth = await freshPyth();
    expect(await pyth.fetchPythPriceHistory("0xunknown", 7)).toEqual([]);

    setFetch(() => notOk());
    expect(await pyth.fetchPythPriceHistory(BTC, 7)).toEqual([]);

    setFetch(() => okJson({ s: "no_data" }));
    expect(await pyth.fetchPythPriceHistory(BTC, 7)).toEqual([]);
  });

  it("fetchPythPriceHistoryHermes returns [] for an unknown market and collects valid points", async () => {
    const pyth = await freshPyth();
    expect(await pyth.fetchPythPriceHistoryHermes("0xunknown", 1, 2)).toEqual([]);

    setFetch((url) => {
      if (url.includes("updates/price/")) {
        return okJson({ parsed: [{ price: { price: "200", expo: 0 } }] });
      }
      return okJson({});
    });
    const pts = await pyth.fetchPythPriceHistoryHermes(BTC, 1, 2);
    expect(pts.length).toBeGreaterThan(0);
  });

  it("fetchPythPriceHistoryHermes skips points when Hermes responds non-ok", async () => {
    const pyth = await freshPyth();
    setFetch(() => notOk());
    expect(await pyth.fetchPythPriceHistoryHermes(BTC, 1, 2)).toEqual([]);
  });
});
