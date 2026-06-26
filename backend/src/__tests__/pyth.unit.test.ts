import { jest } from "@jest/globals";
import * as pyth from "../services/pyth.js";

describe("Pyth Service Logic Paths", () => {
    jest.setTimeout(20000);

    let originalFetch: typeof global.fetch;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        originalFetch = global.fetch;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.useRealTimers();
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("ignores non-numeric Pyth prices", async () => {
        const { fetchPythPrices } = require("../services/pyth.js");
        const mockRes = {
            ok: true,
            json: jest.fn().mockResolvedValue({
                parsed: [{ id: "some-id", price: { price: "NaN", expo: -8 } }]
            })
        };
        (global.fetch as jest.Mock).mockResolvedValue(mockRes);
        const res = await fetchPythPrices();
        // Should ignore NaN price
        expect(Object.keys(res).length).toBe(0);
    });

    it("returns the cache when the Pyth fetch fails or responds non-ok", async () => {
        const { fetchPythPrices } = require("../services/pyth.js");
        
        // Non-ok response
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
        await fetchPythPrices();

        // Returns the cache on a thrown error
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network Fail"));
        const res = await fetchPythPrices();
        expect(res).toEqual({});
    });

    it("returns undefined for 24h change without a symbol or price", async () => {
        const { fetchPyth24hChange } = require("../services/pyth.js");
        
        // No symbol
        expect(await fetchPyth24hChange("0xUnknown")).toBeUndefined();

        // No current price
        // Mock fetchPythPrices to return empty
        const pythSvc = require("../services/pyth.js");
        jest.spyOn(pythSvc, "fetchPythPrices").mockResolvedValue({});
        expect(await fetchPyth24hChange("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c")).toBeUndefined();
    });

    it("returns an empty history on non-ok, bad status, and errors", async () => {
        const { fetchPythPriceHistory } = require("../services/pyth.js");
        const market = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c"; // CFX

        // Non-ok response
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
        expect(await fetchPythPriceHistory(market)).toEqual([]);

        // Status not ok
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({ s: "error" })
        });
        expect(await fetchPythPriceHistory(market)).toEqual([]);

        // Thrown error
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Timeout"));
        expect(await fetchPythPriceHistory(market)).toEqual([]);
    });

    it("returns an empty Hermes history without a feed id, on non-ok, and on errors", async () => {
        const { fetchPythPriceHistoryHermes } = require("../services/pyth.js");
        
        // No feedId
        expect(await fetchPythPriceHistoryHermes("0xUnknown")).toEqual([]);

        // Non-ok response
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
        // Minimal points to avoid long loop
        expect(await fetchPythPriceHistoryHermes("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c", 1, 2)).toEqual([]);

        // Thrown error
        (global.fetch as jest.Mock).mockRejectedValue(new Error("Fetch Failure"));
        expect(await fetchPythPriceHistoryHermes("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c", 1, 1)).toEqual([]);
    });
});
