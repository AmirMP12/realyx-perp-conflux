import { jest } from "@jest/globals";
import { fetchPythPrices } from "../services/pyth.js";

describe("Pyth Service Network Tests", () => {
    let originalFetch: any;

    beforeAll(() => {
        originalFetch = global.fetch;
        (global as any).fetch = jest.fn();
    });

    afterAll(() => {
        (global as any).fetch = originalFetch;
    });

    it("fetchPythPrices should handle network failure gracefully", async () => {
        ((global as any).fetch as any).mockRejectedValue(new Error("Network Down"));
        const prices = await fetchPythPrices();
        expect(prices).toEqual({});
    });

    it("fetchPythPrices should parse Hermes response correctly", async () => {
        ((global as any).fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                parsed: [
                    { id: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', price: { price: "5000000000000", expo: -8 } }
                ]
            })
        });
        const prices = await fetchPythPrices();
        expect(prices["0x986a383f6de4a24dd3f524f0f93546229b58265f"]).toBe(50000);
    });
});
