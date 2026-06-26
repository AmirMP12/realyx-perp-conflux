import { jest } from "@jest/globals";
import fs from "fs";

describe("Configuration Logic Paths", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it("applies testnet defaults for chain id, RPC URL, and node env when unset", async () => {
        // Mock fs.existsSync to prevent .env interference
        jest.spyOn(fs, "existsSync").mockReturnValue(false);

        await jest.isolateModulesAsync(async () => {
             // Clear env
            delete process.env.CHAIN_ID;
            delete process.env.RPC_URL;
            delete process.env.NODE_ENV;
            
            const { config } = await import("../config.js");
            expect(config.chainId).toBe(71);
            expect(config.rpcUrl).toBe("https://evmtestnet.confluxrpc.com");
            expect(config.nodeEnv).toBe("development");
        });
    });

    it("uses the mainnet RPC URL for the mainnet chain id", async () => {
        jest.spyOn(fs, "existsSync").mockReturnValue(false);

        await jest.isolateModulesAsync(async () => {
            process.env.CHAIN_ID = "1030";
            delete process.env.RPC_URL;
            
            const { config } = await import("../config.js");
            expect(config.rpcUrl).toBe("https://evm.confluxrpc.com");
        });
    });
});
