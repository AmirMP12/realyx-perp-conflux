import { jest } from "@jest/globals";

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

import request from "supertest";

describe("app CORS allowlist", () => {
  const prev = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (prev === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = prev;
  });

  it("allows a request from an allowlisted origin", async () => {
    process.env.CORS_ORIGINS = "https://realyx.app, https://app.realyx.app";
    await jest.isolateModulesAsync(async () => {
      const { app } = await import("../app.js");
      const res = await request(app)
        .get("/health")
        .set("Origin", "https://realyx.app");
      expect(res.headers["access-control-allow-origin"]).toBe("https://realyx.app");
    });
  });

  it("rejects a request from a non-allowlisted origin", async () => {
    process.env.CORS_ORIGINS = "https://realyx.app";
    await jest.isolateModulesAsync(async () => {
      const { app } = await import("../app.js");
      const res = await request(app)
        .get("/health")
        .set("Origin", "https://evil.example");
      // cors rejects → no allow-origin header is set for the disallowed origin.
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  it("allows same-origin / non-browser clients (no Origin header)", async () => {
    process.env.CORS_ORIGINS = "https://realyx.app";
    await jest.isolateModulesAsync(async () => {
      const { app } = await import("../app.js");
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    });
  });
});
