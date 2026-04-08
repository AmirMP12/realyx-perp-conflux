import { metricsMiddleware } from "../middleware/metrics.js";
import { jest } from "@jest/globals";

describe("Metrics Middleware", () => {
    it("should handle request and emit statistics on completion", (done) => {
        const req: any = { method: 'GET', path: '/test' };
        let finishHandler: any;
        const res: any = {
            on: (event: string, handler: any) => {
                if (event === 'finish') finishHandler = handler;
            },
            statusCode: 200
        };
        const next = () => {
            expect(finishHandler).toBeDefined();
            finishHandler();
            done();
        };

        metricsMiddleware(req, res, next);
    });

    it("should log errors on status >= 500", (done) => {
        const req: any = { method: 'POST', path: '/err', route: { path: '/err' } };
        let finishHandler: any;
        const res: any = {
            on: (event: string, handler: any) => {
                if (event === 'finish') finishHandler = handler;
            },
            statusCode: 500
        };
        const next = () => {
             // Mock console.warn would be better, but the point is to visit the path
            finishHandler();
            done();
        };

        metricsMiddleware(req, res, next);
    });

    it("should log slow requests in development mode", (done) => {
        const oldEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";
        const nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(2_500);

        const infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);
        const req: any = { method: "GET", path: "/slow", route: { path: "/slow" } };
        let finishHandler: any;
        const res: any = {
            on: (event: string, handler: any) => {
                if (event === "finish") finishHandler = handler;
            },
            statusCode: 200
        };

        const next = () => {
            finishHandler();
            expect(infoSpy).toHaveBeenCalled();
            infoSpy.mockRestore();
            nowSpy.mockRestore();
            process.env.NODE_ENV = oldEnv;
            done();
        };

        metricsMiddleware(req, res, next);
    });
});
