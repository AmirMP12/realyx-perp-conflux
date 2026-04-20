import request from "supertest";
import { app } from "../app.js";
import { ethers } from "ethers";

const VALID_ADDR = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
const VALID_TX = "0x1234567890123456789012345678901234567890123456789012345678901234";

const mockContract = {
    oracleAggregator: jest.fn().mockResolvedValue(VALID_ADDR),
    pyth: jest.fn().mockResolvedValue(VALID_ADDR),
    getOracleConfig: jest.fn().mockResolvedValue([VALID_TX, 0n, 0n, 0n]),
    getUpdateFee: jest.fn().mockResolvedValue(100n),
    updatePriceFeeds: jest.fn().mockResolvedValue({
        hash: VALID_TX,
        wait: jest.fn().mockResolvedValue({ hash: VALID_TX }),
    }),
};

jest.mock("ethers", () => {
    const mockProvider = jest.fn().mockImplementation(() => ({
        getNetwork: jest.fn().mockResolvedValue({ chainId: 1030 }),
        getBlockNumber: jest.fn().mockResolvedValue(1000),
        getLogs: jest.fn().mockResolvedValue([]),
    }));
    const mockWallet = jest.fn().mockImplementation(() => ({
        address: VALID_ADDR,
        connect: jest.fn().mockReturnThis(),
        provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: 1030 }) },
    }));
    const mockContractCtor = jest.fn().mockImplementation((addr, abi) => {
        const sAbi = JSON.stringify(abi);
        if (sAbi.includes("oracleAggregator")) return { oracleAggregator: mockContract.oracleAggregator };
        if (sAbi.includes("getOracleConfig")) return { pyth: mockContract.pyth, getOracleConfig: mockContract.getOracleConfig };
        if (sAbi.includes("updatePriceFeeds")) return { getUpdateFee: mockContract.getUpdateFee, updatePriceFeeds: mockContract.updatePriceFeeds };
        return mockContract;
    });
    const mockInterface = jest.fn().mockImplementation(() => ({
        parseLog: jest.fn(),
    }));

    const mockEthers = {
        JsonRpcProvider: mockProvider,
        Wallet: mockWallet,
        Contract: mockContractCtor,
        Interface: mockInterface,
        id: jest.fn().mockReturnValue("0xTopic"),
        isAddress: jest.fn().mockReturnValue(true),
        ZeroHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    return {
        ...mockEthers,
        ethers: mockEthers,
    };
});

describe("Pyth Refresh Route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = "test-secret";
        process.env.PYTH_REFRESH_PRIVATE_KEY = VALID_TX;
        process.env.RPC_URL = "http://localhost:8545";
        process.env.TRADING_CORE_ADDRESS = VALID_ADDR;

        global.fetch = jest.fn().mockImplementation(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ binary: { data: ["0xabc"] } }),
            text: () => Promise.resolve("ok"),
        })) as any;
    });

    it("should successfully refresh prices", async () => {
        const res = await request(app)
            .get(`/api/pyth-refresh?markets=${VALID_ADDR}`)
            .set("Authorization", "Bearer test-secret");
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("should handle error in contract call", async () => {
        mockContract.oracleAggregator.mockRejectedValueOnce(new Error("Call Failed"));

        const res = await request(app)
            .get(`/api/pyth-refresh?markets=${VALID_ADDR}`)
            .set("Authorization", "Bearer test-secret");
        
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Call Failed");
    });
});
