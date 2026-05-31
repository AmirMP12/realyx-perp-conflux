import request from "supertest";
import { app } from "../app.js";

describe("Debug Route Auth", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("is open in non-production", async () => {
    process.env.NODE_ENV = "test";
    const res = await request(app).get("/api/debug");
    expect(res.status).toBe(200);
  });

  it("returns 404 in production when no DEBUG_SECRET is configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.DEBUG_SECRET;
    const res = await request(app).get("/api/debug");
    expect(res.status).toBe(404);
  });

  it("returns 401 in production with a wrong secret", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEBUG_SECRET = "admin-secret";
    const res = await request(app).get("/api/debug?key=nope");
    expect(res.status).toBe(401);
  });

  it("allows access in production with the correct secret", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEBUG_SECRET = "admin-secret";
    const res = await request(app).get("/api/debug?key=admin-secret");
    expect(res.status).toBe(200);
  });
});
