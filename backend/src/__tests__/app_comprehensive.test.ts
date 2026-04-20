import request from "supertest";
import { app } from "../app.js";
import pino from "pino";

// We need to trigger the error handler. 
// A simple way is to mock a route and make it throw.
jest.mock("../routes/health.js", () => {
    const express = require("express");
    const router = express.Router();
    router.get("/error-429", (req: any, res: any, next: any) => {
        const err: any = new Error("Rate limit");
        err.status = 429;
        next(err);
    });
    router.get("/error-500", (req: any, res: any, next: any) => {
        next(new Error("Generic error"));
    });
    router.get("/", (req: any, res: any) => res.json({ status: "ok" }));
    return router;
});

describe("Application Comprehensive Integration", () => {
    it("should return 404 for unknown routes", async () => {
        const res = await request(app).get("/unknown-route-12345");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Not found");
    });

    it("should handle 429 errors in global error handler", async () => {
        const res = await request(app).get("/health/error-429");
        expect(res.status).toBe(429);
        expect(res.body.error).toBe("Too many requests");
    });

    it("should handle generic 500 errors in global error handler", async () => {
        const res = await request(app).get("/health/error-500");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Internal server error");
    });

    it("should cover pino logger level assignment branches", () => {
        // This is tricky because the logger is created at module load.
        // We can't easily re-import with different NODE_ENV in Jest without jest.resetModules()
        // But we can check if it loaded correctly with 'test' level (which should be 'silent' according to src/app.ts)
        const { logger } = require("../app.js");
        expect(logger.level).toBe("silent");
    });
});
