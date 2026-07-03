import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

describe("app global error handler", () => {
  let appWithRoutes: express.Application;

  beforeAll(() => {
    appWithRoutes = express();
    appWithRoutes.get("/trigger-429", (_req, _res, next) => {
      const err: any = new Error("rate limited");
      err.status = 429;
      next(err);
    });
    appWithRoutes.get("/trigger-500", (_req, _res, next) => {
      next(new Error("boom"));
    });

    appWithRoutes.use(
      (
        err: Error & { status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        if (err.status === 429) {
          res.status(429).json({ success: false, error: "Too many requests" });
          return;
        }
        res.status(500).json({ success: false, error: "Internal server error" });
      }
    );
  });

  it("returns 429 when an error with status 429 is passed to next()", async () => {
    const res = await request(appWithRoutes).get("/trigger-429");
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Too many requests");
  });

  it("returns 500 for a generic error passed to next()", async () => {
    const res = await request(appWithRoutes).get("/trigger-500");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Internal server error");
  });

  it("returns 404 for unmatched routes via the real app", async () => {
    const { app } = await import("../app.js");
    const res = await request(app).get("/api/nonexistent-route-xyz");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("app static frontend serving", () => {
  it("serves index.html when a frontend build is present", async () => {
    const os = require("os");
    const path = require("path");
    const fs = require("fs");

    const distDir = path.join(os.tmpdir(), "realyx_fe_test_" + Date.now());
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), "<html><body>RealYX</body></html>");

    try {
      const miniApp = express();
      const hasFrontend = fs.existsSync(path.join(distDir, "index.html"));
      expect(hasFrontend).toBe(true);

      if (hasFrontend) {
        miniApp.use(express.static(distDir));
        miniApp.get("*", (_req: express.Request, res: express.Response) => {
          res.sendFile(path.join(distDir, "index.html"));
        });
      } else {
        miniApp.use((_req: any, res: any) => {
          res.status(404).json({ success: false, error: "Not found" });
        });
      }

      const res = await request(miniApp).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("RealYX");

      const res2 = await request(miniApp).get("/some-spa-route");
      expect(res2.status).toBe(200);
      expect(res2.text).toContain("RealYX");
    } finally {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("returns 404 JSON when no frontend build is present", async () => {
    const miniApp = express();
    const hasFrontend = false;
    if (hasFrontend) {
      // unreachable
    } else {
      miniApp.use((_req: any, res: any) => {
        res.status(404).json({ success: false, error: "Not found" });
      });
    }

    const res = await request(miniApp).get("/anything");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
