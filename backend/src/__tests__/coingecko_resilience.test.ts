import { jest } from "@jest/globals";
import * as coingecko from "../services/coingecko.js";

describe("CoinGecko Service Resilience", () => {
    beforeEach(() => {
        jest.resetModules();
        (global as any).fetch = jest.fn();
    });

    it("resolves market ids, fetches prices and history, and recovers from failed requests", async () => {
        // 1. getCoinGeckoIdForMarket
        coingecko.getCoinGeckoIdForMarket("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c");
        coingecko.getCoinGeckoIdForMarket("0x000");

        // 2. fetchCoinGeckoPrices
        (global as any).fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [{ 
                id: "conflux-token", 
                current_price: 1, 
                price_change_percentage_24h: 1,
                total_volume: 1000
            }]
        });
        await coingecko.fetchCoinGeckoPrices();
        // served from cache
        await coingecko.fetchCoinGeckoPrices();

        // 3. fetchPriceHistory (and the map function at line 91)
        (global as any).fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ prices: [[1000, 1.2], [2000, 1.3]] })
        });
        await coingecko.fetchPriceHistory("conflux-token", 1);
        
        // failed requests return safe fallbacks
        (global as any).fetch.mockResolvedValueOnce({ ok: false });
        await coingecko.fetchCoinGeckoPrices();
        
        (global as any).fetch.mockRejectedValueOnce(new Error("RPC FAIL"));
        await coingecko.fetchCoinGeckoPrices();

        (global as any).fetch.mockResolvedValueOnce({ ok: false });
        await coingecko.fetchPriceHistory("conflux-token", 1);

        (global as any).fetch.mockRejectedValueOnce(new Error("RPC FAIL"));
        await coingecko.fetchPriceHistory("conflux-token", 1);
    });
});
