import { jest } from "@jest/globals";

describe("On-chain Market Logic Paths", () => {
    jest.setTimeout(15000);

    beforeEach(() => {
        jest.resetModules();
        process.env.TRADING_CORE_ADDRESS = "0x1234567890123456789012345678901234567890";
        process.env.RPC_URL = "http://localhost:8545";
    });

    it("hits toStr edge cases (lines 51-52)", async () => {
        const mProvider = {
            getNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
            _detectNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
        };
        const mContract = {
            activeMarketCount: jest.fn().mockResolvedValue(1n),
            activeMarketAt: jest.fn().mockResolvedValue("0xMarket"),
            getMarketInfo: jest.fn().mockResolvedValue({
                maxLeverage: Infinity,
                maxPositionSize: { invalid: true },
                maxTotalExposure: 100n,
                totalLongSize: 0,
                totalShortSize: 0,
                isActive: true,
                isListed: true
            }),
            getFundingState: jest.fn().mockResolvedValue(null)
        };

        jest.doMock("ethers", () => ({
            ethers: {
                JsonRpcProvider: jest.fn().mockImplementation(() => mProvider),
                Contract: jest.fn().mockImplementation(() => mContract),
                Interface: jest.fn()
            }
        }));

        const { fetchMarketsOnChain } = require("../services/fetchMarketsOnchain.js");
        const res = await fetchMarketsOnChain();
        expect(res.length).toBeGreaterThan(0);
        expect(res[0].maxLeverage).toBe("0"); 
        expect(res[0].maxPositionSize).toBe("[object Object]");
    });

    it("triggers RPC failure and all RPCs failed warning (172-176)", async () => {
        jest.doMock("ethers", () => ({
            ethers: {
                JsonRpcProvider: jest.fn().mockImplementation(() => ({
                    getNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
                    _detectNetwork: jest.fn().mockResolvedValue({ chainId: 71n }),
                })),
                Contract: jest.fn().mockImplementation(() => ({
                    activeMarketCount: jest.fn().mockRejectedValue(new Error("RPC Error")),
                })),
                Interface: jest.fn()
            }
        }));

        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        const { fetchMarketsOnChain } = require("../services/fetchMarketsOnchain.js");
        
        const res = await fetchMarketsOnChain();
        expect(res).toEqual([]);
        warnSpy.mockRestore();
    });
});
