import { jest } from "@jest/globals";
import { getPythFeedId, getPythTvSymbol } from "../services/pyth.js";

describe("Pyth Service Helpers", () => {
    it("getPythFeedId should return correct ID for known markets", () => {
        const btc = "0x986a383f6de4a24dd3f524f0f93546229b58265f";
        expect(getPythFeedId(btc)).toBe("0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43");
        expect(getPythFeedId("0xUnknown")).toBeUndefined();
    });

    it("getPythTvSymbol should return correct symbol", () => {
        const eth = "0x886a383f6de4a24dd3f524f0f93546229b58265f";
        expect(getPythTvSymbol(eth)).toBe("Crypto.ETH/USD");
        expect(getPythTvSymbol("0xabc")).toBeNull();
    });
});

import { fetchProtocol } from "../services/subgraph.js";
jest.mock("../services/subgraph.js", () => ({
    fetchProtocol: jest.fn().mockResolvedValue({ totalVolumeUsd: "100" }),
    fetchMarkets: jest.fn().mockResolvedValue([]),
    fetchUserPositions: jest.fn().mockResolvedValue([]),
    fetchUserTrades: jest.fn().mockResolvedValue([]),
    fetchLeaderboard: jest.fn().mockResolvedValue([]),
    fetchBadDebtClaims: jest.fn().mockResolvedValue([]),
    fetchProtocolMetrics: jest.fn().mockResolvedValue([]),
}));

describe("Subgraph Service Basic", () => {
    it("should work with mocked fetchProtocol", async () => {
        const p = await fetchProtocol();
        expect(p?.totalVolumeUsd).toBe("100");
    });
});
