import { jest } from "@jest/globals";
import { ethers } from "ethers";

const mContractInstance = {
    activeMarketCount: jest.fn().mockResolvedValue(1n),
    activeMarketAt: jest.fn().mockResolvedValue("0xMarketAddress"),
    getNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
};

const mProviderInstance = {
    getNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
};

jest.mock("ethers", () => {
    return {
        __esModule: true,
        Contract: jest.fn(() => mContractInstance),
        JsonRpcProvider: jest.fn(() => mProviderInstance),
        ethers: {
            Contract: jest.fn(() => mContractInstance),
            JsonRpcProvider: jest.fn(() => mProviderInstance),
        }
    };
});

describe("Active Markets Logic Paths", () => {
    jest.setTimeout(20000);

    let activeMarkets: any;

    beforeEach(async () => {
        jest.resetModules();
        process.env.ENABLE_ACTIVE_MARKETS_FILTER = "true";
        process.env.TRADING_CORE_ADDRESS = "0xTradingCore";
        process.env.RPC_URL = "http://rpc1.com";
        process.env.RPC_FALLBACK_URL = "http://rpc2.com";
        process.env.NODE_ENV = "test";
        process.env.CHAIN_ID = "999"; 

        mContractInstance.activeMarketCount.mockResolvedValue(1n);
        mContractInstance.activeMarketAt.mockResolvedValue("0xMarketAddress");

        activeMarkets = await import("../services/activeMarkets.js");
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("hits enabled/disabled branches (31, 61)", async () => {
        process.env.ENABLE_ACTIVE_MARKETS_FILTER = "false";
        process.env.VERCEL = "1";
        expect(await activeMarkets.getActiveMarketAddresses()).toBeNull();
    });

    it("hits cache and missing address branches (66, 72-73)", async () => {
        delete process.env.TRADING_CORE_ADDRESS;
        delete process.env.DEPLOYED_TRADING_CORE;
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        expect(await activeMarkets.getActiveMarketAddresses()).toBeNull();
        warnSpy.mockRestore();

        process.env.TRADING_CORE_ADDRESS = "0xTradingCore";
        
        await activeMarkets.getActiveMarketAddresses();
        const res = await activeMarkets.getActiveMarketAddresses();
        expect(res?.has("0xmarketaddress")).toBe(true);
    });

    it("hits RPC fallback loop (86-90)", async () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        mContractInstance.activeMarketCount.mockRejectedValue(new Error("RPC Fail"));
        
        await activeMarkets.getActiveMarketAddresses();
        
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
