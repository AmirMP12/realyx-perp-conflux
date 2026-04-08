import { apiRateLimit, checkWsRateLimit, decrementWsCount } from "../middleware/rateLimit.js";
import { jest } from "@jest/globals";

describe("Rate Limit Middleware", () => {
    it("should allow initial request", () => {
        const next = jest.fn();
        apiRateLimit({ ip: '1.2.3.4' }, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    it("should track WS connections", () => {
        const ip = "10.0.0.1";
        expect(checkWsRateLimit(ip)).toBe(true);
        decrementWsCount(ip);
        // decrement all to clear
        decrementWsCount(ip);
    });

    it("should fail WS limit if exceeded", () => {
        const ip = "huge.ip";
        for (let i=0; i<10; i++) checkWsRateLimit(ip);
        expect(checkWsRateLimit(ip)).toBe(false);
    });
});
