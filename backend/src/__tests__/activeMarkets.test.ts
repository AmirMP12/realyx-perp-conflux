import { jest } from "@jest/globals";
import { getActiveMarketAddresses } from "../services/activeMarkets.js";
import { ethers } from "ethers";

jest.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
    Contract: jest.fn().mockImplementation(() => ({
      activeMarketCount: jest.fn().mockResolvedValue(1n),
      activeMarketAt: jest.fn().mockResolvedValue("0x123")
    }))
  }
}));

describe("Active Markets Service", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.RPC_URL = "http://localhost:8545";
        process.env.TRADING_CORE_ADDRESS = "0xabc";
        process.env.CHAIN_ID = "71";
    });

    it("getActiveMarketAddresses should return a set of lowercased addresses", async () => {
        const set = await getActiveMarketAddresses();
        expect(set).toBeDefined();
        expect(set?.has("0x123")).toBe(true);
    });

    it("should handle RPC failure", async () => {
        // Advance time by 60 seconds to bypass cache (TTL is 30s)
        const realDateNow = Date.now;
        jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + 60_000);

        // Mock Contract to throw
        (ethers.Contract as any).mockImplementation(() => ({
            activeMarketCount: jest.fn().mockRejectedValue(new Error("RPC Error"))
        }));
        const set = await getActiveMarketAddresses();
        expect(set).toBeNull();

        // Restore Date.now
        (Date.now as any).mockRestore();
    });
});
