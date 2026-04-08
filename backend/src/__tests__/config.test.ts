import { config } from "../config.js";

describe("Config", () => {
    it("should possess all environment variables", () => {
        expect(config.port).toBeDefined();
        expect(config.wsPort).toBeDefined();
        expect(config.postgresUrl).toBeUndefined(); // It is undefined in testing normally, but part of schema
        expect(config.chainId).toBeDefined();
        expect(config.nodeEnv).toBeDefined();
        expect(config.metricsPort).toBeDefined();
    });
});
