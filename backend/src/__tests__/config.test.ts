import { config } from "../config.js";

describe("Config", () => {
    it("should possess all environment variables", () => {
        expect(config.port).toBeDefined();
        expect(config.wsPort).toBeDefined();
        expect(config.postgresUrl === undefined || typeof config.postgresUrl === 'string').toBe(true);
        expect(config.chainId).toBeDefined();
        expect(config.rpcUrl).toBeDefined();
        expect(config.nodeEnv).toBeDefined();
        expect(config.metricsPort).toBeDefined();
    });
});
