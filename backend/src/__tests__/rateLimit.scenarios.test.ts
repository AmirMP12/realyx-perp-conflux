import { jest } from "@jest/globals";
import * as rateLimit from "../middleware/rateLimit.js";

describe("Rate Limit Comprehensive Logic Scenarios", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe("getClientIp", () => {
        it("handles x-forwarded-for as string", () => {
            const req = { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } };
            // @ts-ignore
            expect(rateLimit.getClientIp(req)).toBe("1.2.3.4");
        });

        it("handles x-forwarded-for as array", () => {
            const req = { headers: { "x-forwarded-for": ["2.3.4.5", "6.7.8.9"] } };
            // @ts-ignore
            expect(rateLimit.getClientIp(req)).toBe("2.3.4.5");
        });

        it("falls back to req.ip", () => {
            const req = { ip: "127.0.0.1", headers: {} };
            // @ts-ignore
            expect(rateLimit.getClientIp(req)).toBe("127.0.0.1");
        });

        it("returns unknown if nothing set", () => {
            const req = { headers: {} };
            // @ts-ignore
            expect(rateLimit.getClientIp(req)).toBe("unknown");
        });
    });

    describe("apiRateLimit", () => {
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            req = { ip: "1.1.1.1", headers: {} };
            res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
            next = jest.fn();
            // Clear internal state by resetting the module if needed, but here we can just use different IPs
        });

        it("allows first request and sets entry", () => {
            rateLimit.apiRateLimit(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it("allows subsequent requests within limit", () => {
            const myIp = "2.2.2.2";
            const myReq = { ip: myIp, headers: {} };
            rateLimit.apiRateLimit(myReq, res, next);
            rateLimit.apiRateLimit(myReq, res, next);
            expect(next).toHaveBeenCalledTimes(2);
        });

        it("resets count after windowMs", () => {
            const myIp = "3.3.3.3";
            const myReq = { ip: myIp, headers: {} };
            rateLimit.apiRateLimit(myReq, res, next);
            
            jest.advanceTimersByTime(61000);
            
            rateLimit.apiRateLimit(myReq, res, next);
            expect(next).toHaveBeenCalledTimes(2);
        });

        it("returns 429 when limit exceeded", () => {
            const myIp = "4.4.4.4";
            const myReq = { ip: myIp, headers: {} };
            // Limit is 100
            for (let i = 0; i < 100; i++) {
                rateLimit.apiRateLimit(myReq, res, next);
            }
            expect(next).toHaveBeenCalledTimes(100);

            rateLimit.apiRateLimit(myReq, res, next);
            expect(res.status).toHaveBeenCalledWith(429);
        });

        it("passes error to next if res.status is missing", () => {
            const myIp = "5.5.5.5";
            const myReq = { ip: myIp, headers: {} };
            const noStatusRes = {};
            for (let i = 0; i < 100; i++) {
                rateLimit.apiRateLimit(myReq, noStatusRes, next);
            }
            rateLimit.apiRateLimit(myReq, noStatusRes, next);
            expect(next).toHaveBeenLastCalledWith(expect.any(Error));
            expect(next.mock.calls[next.mock.calls.length - 1][0].status).toBe(429);
        });
    });

    describe("WS Rate Limit", () => {
        it("triggers limit and clears count", () => {
            const ip = "6.6.6.6";
            // Limit is 10
            for (let i = 0; i < 10; i++) {
                expect(rateLimit.checkWsRateLimit(ip)).toBe(true);
            }
            expect(rateLimit.checkWsRateLimit(ip)).toBe(false);

            rateLimit.decrementWsCount(ip);
            expect(rateLimit.checkWsRateLimit(ip)).toBe(true);
            
            // Clear it down
            for (let i = 0; i < 10; i++) rateLimit.decrementWsCount(ip);
            // Should be deleted now
            expect(rateLimit.checkWsRateLimit(ip)).toBe(true);
        });
    });
});
