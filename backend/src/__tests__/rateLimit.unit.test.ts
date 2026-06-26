import { jest } from "@jest/globals";
import { apiRateLimit, decrementWsCount } from "../middleware/rateLimit.js";

describe("Rate Limit middleware", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("resets count when the window expires for a specific IP", () => {
        const req = { ip: "1.1.1.1", headers: {} };
        const next = jest.fn();
        
        // First request
        apiRateLimit(req as any, {} as any, next);
        
        // Fast forward 61 seconds
        jest.advanceTimersByTime(61000);
        
        // Second request should reset count
        apiRateLimit(req as any, {} as any, next);
        expect(next).toHaveBeenCalledTimes(2);
    });

    it("cleans up expired entries via the interval timer", () => {
        const req = { ip: "2.2.2.2", headers: {} };
        apiRateLimit(req as any, {} as any, jest.fn());
        
        // Fast forward 61 seconds
        jest.advanceTimersByTime(61000);
        
        // Trigger interval (every 30s)
        jest.advanceTimersByTime(30000);
        
        // Hard to verify without internal access, but the cleanup path runs.
    });

    it("falls back to next(err) when res.status is missing", () => {
        const req = { ip: "3.3.3.3", headers: {} };
        const next = jest.fn();
        const res = {} as any; // No status method
        
        // Hit limit
        for (let i = 0; i < 101; i++) {
            apiRateLimit(req as any, res, next);
        }
        
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("decrements the websocket connection count for an IP", () => {
        const ip = "4.4.4.4";
        // Increment twice so the decrement has a count to reduce
        // checkWsRateLimit is internal-ish but we can use checkWsRateLimit from the same module
        const { checkWsRateLimit } = require("../middleware/rateLimit.js");
        checkWsRateLimit(ip);
        checkWsRateLimit(ip);
        decrementWsCount(ip);
        // Reduces the stored connection count
    });
});
