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

    it("hits parsePythPrice edge cases (56-57)", async () => {
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

    it("hits fetchPythPrices cache and error branches (62-64, 70, 89)", async () => {
        const { fetchPythPrices } = require("../services/pyth.js");
        
        // 70: !res.ok
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
        await fetchPythPrices();

        // 89: Cache return on catch
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network Fail"));
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        const res = await fetchPythPrices();
        expect(res).toEqual({});
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it("hits fetchPyth24hChange branches (114, 117, 128)", async () => {
        const { fetchPyth24hChange } = require("../services/pyth.js");
        
        // 114: No symbol
        expect(await fetchPyth24hChange("0xUnknown")).toBeUndefined();

        // 117: No current price
        // Mock fetchPythPrices to return empty
        const pythSvc = require("../services/pyth.js");
        jest.spyOn(pythSvc, "fetchPythPrices").mockResolvedValue({});
        expect(await fetchPyth24hChange("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c")).toBeUndefined();
    });

    it("hits fetchPythPriceHistory branches (149, 151, 154)", async () => {
        const { fetchPythPriceHistory } = require("../services/pyth.js");
        const market = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c"; // CFX

        // 149: !res.ok
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
        expect(await fetchPythPriceHistory(market)).toEqual([]);

        // 151: data.s !== "ok"
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({ s: "error" })
        });
        expect(await fetchPythPriceHistory(market)).toEqual([]);

        // 154: Catch block
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Timeout"));
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        expect(await fetchPythPriceHistory(market)).toEqual([]);
        warnSpy.mockRestore();
    });

    it("hits fetchPythPriceHistoryHermes branches (166, 177, 183)", async () => {
        const { fetchPythPriceHistoryHermes } = require("../services/pyth.js");
        
        // 166: No feedId
        expect(await fetchPythPriceHistoryHermes("0xUnknown")).toEqual([]);

        // 177: !res.ok
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
        // Minimal points to avoid long loop
        expect(await fetchPythPriceHistoryHermes("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c", 1, 2)).toEqual([]);

        // 183: Catch block
        (global.fetch as jest.Mock).mockRejectedValue(new Error("Fetch Failure"));
        expect(await fetchPythPriceHistoryHermes("0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c", 1, 1)).toEqual([]);
    });
});
