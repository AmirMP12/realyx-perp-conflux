import { 
    fetchPythPrices, 
    fetchPyth24hChange, 
    fetchPythPriceHistory, 
    getPythFeedId,
    getPythTvSymbol
} from "../services/pyth.js";

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const VALID_ADDR = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";

describe("Pyth Service Extended Scenarios", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe("fetchPythPrices", () => {
        it("should return cached prices if fresh", async () => {
            const { fetchPythPrices } = require("../services/pyth.js");
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ parsed: [{ id: "8879170230c9603342f3837cf9a8e76c61791198fb1271bb2552c9af7b33c933", price: { price: "1000", expo: -2 } }] })
            });
            
            const first = await fetchPythPrices();
            expect(mockFetch).toHaveBeenCalledTimes(1);
            
            const second = await fetchPythPrices();
            expect(mockFetch).toHaveBeenCalledTimes(1); 
            expect(second).toEqual(first);
        });

        it("should handle non-ok response returning cached", async () => {
            const { fetchPythPrices } = require("../services/pyth.js");
            mockFetch.mockResolvedValueOnce({ ok: false });
            const prices = await fetchPythPrices();
            expect(prices).toEqual({});
        });
    });

    describe("fetchPyth24hChange", () => {
        const market = VALID_ADDR;

        it("should return cached value if fresh", async () => {
            const { fetchPyth24hChange } = require("../services/pyth.js");
            mockFetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ parsed: [{ id: "8879170230c9603342f3837cf9a8e76c61791198fb1271bb2552c9af7b33c933", price: { price: "1200", expo: -2 } }] }) })
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ s: "ok", t: [Math.floor(Date.now()/1000) - 86400], c: [10.0] }) });
            
            const first = await fetchPyth24hChange(market);
            expect(first).toBeDefined();
            
            const second = await fetchPyth24hChange(market);
            expect(second).toBe(first);
        });

        it("should handle benchmarks API error returning undefined", async () => {
            const { fetchPyth24hChange } = require("../services/pyth.js");
            mockFetch.mockResolvedValueOnce({ ok: false }); 
            const res = await fetchPyth24hChange(market);
            expect(res).toBeUndefined(); // Source returns undefined on !res.ok
        });
        
        it("should handle invalid market returning undefined", async () => {
             const { fetchPyth24hChange } = require("../services/pyth.js");
             const res = await fetchPyth24hChange("0xInvalid");
             expect(res).toBeUndefined();
        });
    });

    describe("fetchPythPriceHistory", () => {
        const market = VALID_ADDR;

        it("should handle timeout", async () => {
            const { fetchPythPriceHistory } = require("../services/pyth.js");
            mockFetch.mockRejectedValueOnce(new Error("Timeout"));
            const history = await fetchPythPriceHistory(market);
            expect(history).toEqual([]);
        });
    });

    describe("fetchPythPriceHistoryHermes", () => {
        const market = VALID_ADDR;

        it("should handle individual fetch success and failure", async () => {
             const { fetchPythPriceHistoryHermes } = require("../services/pyth.js");
             mockFetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ parsed: [{ price: { price: "1000", expo: -2 } }] }) })
                .mockResolvedValueOnce({ ok: false }) // should continue
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ parsed: [] }) }); // missing price, should continue
             
             // To speed up, we should mock setTimeout or just test with 2 points
             const res = await fetchPythPriceHistoryHermes(market, 1, 3);
             expect(res.length).toBe(1);
        });

        it("should handle catch block (183-185)", async () => {
             const { fetchPythPriceHistoryHermes } = require("../services/pyth.js");
             mockFetch.mockRejectedValue(new Error("Network Fail"));
             const res = await fetchPythPriceHistoryHermes(market, 1, 2);
             expect(res).toEqual([]);
        });
    });

    describe("Utils", () => {
        it("should return feed id and tv symbol correctly", () => {
            expect(getPythFeedId(VALID_ADDR)).toBeDefined();
            expect(getPythTvSymbol(VALID_ADDR)).toBe("Crypto.CFX/USD");
        });
    });
});
