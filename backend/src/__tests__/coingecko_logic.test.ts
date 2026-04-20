import { fetchCoinGeckoPrices, fetchPriceHistory } from "../services/coingecko.js";

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("CoinGecko Service Logic Paths", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear module level cache if possible - or just use different data
        jest.resetModules();
    });

    it("should cover fetchCoinGeckoPrices cache and non-ok response", async () => {
        const { fetchCoinGeckoPrices } = require("../services/coingecko.js");
        
        // Non-ok response
        mockFetch.mockResolvedValueOnce({ ok: false });
        const res1 = await fetchCoinGeckoPrices();
        expect(res1).toEqual({});

        // OK response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([
                { id: "conflux-token", current_price: 0.2, price_change_percentage_24h: 5, total_volume: 1000 },
                { id: "bitcoin", current_price: null, price_change_percentage_24h: null, total_volume: "not a number" }
            ])
        });
        const res2 = await fetchCoinGeckoPrices();
        expect(res2["conflux-token"].price).toBe(0.2);
        expect(res2["bitcoin"].price).toBe(0); // Fallback branch
        expect(res2["bitcoin"].volume24h).toBeUndefined(); // Fallback branch

        // Cache hit
        const res3 = await fetchCoinGeckoPrices();
        expect(mockFetch).toHaveBeenCalledTimes(2); // Only twice (error then success, then cache)
    });

    it("should cover fetchCoinGeckoPrices catch block", async () => {
        const { fetchCoinGeckoPrices } = require("../services/coingecko.js");
        mockFetch.mockRejectedValue(new Error("Network Error"));
        const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
        
        const res = await fetchCoinGeckoPrices();
        expect(res).toEqual({});
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it("should cover fetchPriceHistory branches", async () => {
        // Non-ok
        mockFetch.mockResolvedValueOnce({ ok: false });
        expect(await fetchPriceHistory("bitcoin")).toEqual([]);

        // OK with missing prices
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ })
        });
        expect(await fetchPriceHistory("bitcoin")).toEqual([]);

        // Catch block
        mockFetch.mockRejectedValue(new Error("Boom"));
        expect(await fetchPriceHistory("bitcoin")).toEqual([]);
    });
});
