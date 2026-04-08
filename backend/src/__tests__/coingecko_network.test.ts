import { jest } from "@jest/globals";
import { fetchCoinGeckoPrices, getCoinGeckoIdForMarket } from "../services/coingecko.js";

describe("CoinGecko Service Network", () => {
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = global.fetch;
    (global as any).fetch = jest.fn();
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it("fetchCoinGeckoPrices should parse markets response", async () => {
    ((global as any).fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'bitcoin', current_price: 50000, price_change_percentage_24h: 2.5 }
      ]
    });

    const data = await fetchCoinGeckoPrices();
    expect(data['bitcoin']).toBeDefined();
    expect(data['bitcoin']?.price).toBe(50000);
  });

  it("getCoinGeckoIdForMarket should return id for bitcoin market", () => {
    const id = getCoinGeckoIdForMarket("0x986a383f6de4a24dd3f524f0f93546229b58265f");
    expect(id).toBe("bitcoin");
  });
});
