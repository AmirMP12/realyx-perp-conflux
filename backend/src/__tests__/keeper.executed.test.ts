import request from "supertest";
import { app } from "../app.js";

describe("Keeper routes (extended)", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  describe("auth fail-closed in production", () => {
    it("returns 503 when no secret is configured in production", async () => {
      delete process.env.KEEPER_WEBHOOK_SECRET;
      process.env.NODE_ENV = "production";
      const res = await request(app)
        .post("/api/v1/keeper/failure")
        .send({ orderId: "1", traderAddress: "0xABC" });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/);
    });
  });

  describe("POST /api/v1/keeper/executed", () => {
    beforeEach(() => {
      delete process.env.KEEPER_WEBHOOK_SECRET;
      process.env.NODE_ENV = "test";
    });

    it("accepts latencySeconds", async () => {
      const res = await request(app)
        .post("/api/v1/keeper/executed")
        .send({ latencySeconds: 1.5 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("accepts latencyMs and converts to seconds", async () => {
      const res = await request(app)
        .post("/api/v1/keeper/executed")
        .send({ latencyMs: 2500 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("rejects when neither field is provided", async () => {
      const res = await request(app).post("/api/v1/keeper/executed").send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects a negative latency", async () => {
      const res = await request(app)
        .post("/api/v1/keeper/executed")
        .send({ latencySeconds: -5 });
      expect(res.status).toBe(400);
    });

    it("rejects a non-numeric latency", async () => {
      const res = await request(app)
        .post("/api/v1/keeper/executed")
        .send({ latencySeconds: "fast" });
      expect(res.status).toBe(400);
    });

    it("requires a valid secret in production", async () => {
      process.env.KEEPER_WEBHOOK_SECRET = "s3cret";
      const res = await request(app)
        .post("/api/v1/keeper/executed")
        .set("Authorization", "Bearer wrong")
        .send({ latencySeconds: 1 });
      expect(res.status).toBe(401);
    });
  });
});
