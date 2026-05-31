import request from "supertest";
import { app } from "../app.js";

describe("Keeper Routes", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  describe("POST /api/v1/keeper/failure auth", () => {
    it("allows the webhook in non-production when no secret is set", async () => {
      delete process.env.KEEPER_WEBHOOK_SECRET;
      process.env.NODE_ENV = "test";
      const res = await request(app)
        .post("/api/v1/keeper/failure")
        .send({ orderId: "1", traderAddress: "0xABC" });
      // Not a 401/503 — auth passed (200 success path with mocked pg).
      expect([200, 500]).toContain(res.status);
      expect(res.status).not.toBe(401);
    });

    it("rejects requests with a wrong secret", async () => {
      process.env.KEEPER_WEBHOOK_SECRET = "s3cret";
      const res = await request(app)
        .post("/api/v1/keeper/failure")
        .set("Authorization", "Bearer wrong")
        .send({ orderId: "1", traderAddress: "0xABC" });
      expect(res.status).toBe(401);
    });

    it("accepts requests with the correct secret", async () => {
      process.env.KEEPER_WEBHOOK_SECRET = "s3cret";
      const res = await request(app)
        .post("/api/v1/keeper/failure")
        .set("Authorization", "Bearer s3cret")
        .send({ orderId: "1", traderAddress: "0xABC" });
      expect(res.status).not.toBe(401);
      expect([200, 500]).toContain(res.status);
    });

    it("validates required fields after auth", async () => {
      process.env.KEEPER_WEBHOOK_SECRET = "s3cret";
      const res = await request(app)
        .post("/api/v1/keeper/failure")
        .set("Authorization", "Bearer s3cret")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/v1/keeper/failures/:traderAddress", () => {
    it("returns a data array", async () => {
      const res = await request(app).get("/api/v1/keeper/failures/0xABC");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
