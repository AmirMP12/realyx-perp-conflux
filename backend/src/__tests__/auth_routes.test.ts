import { jest } from "@jest/globals";

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

import request from "supertest";
import { ethers } from "ethers";
import { app } from "../app.js";

// The global setup mocks `pg`; grab the shared mock pool so we can drive query results.
function getMockPoolQuery(): jest.Mock {
  const pg = require("pg");
  const pool = new pg.default.Pool();
  return pool.query as jest.Mock;
}

const DOMAIN = {
  name: "RealYX",
  version: "1",
  chainId: parseInt(process.env.CHAIN_ID ?? "71", 10),
};
const TYPES = {
  GenerateApiKey: [
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

describe("Auth routes", () => {
  const prevPg = process.env.POSTGRES_URL;
  let query: jest.Mock;

  beforeAll(() => {
    process.env.POSTGRES_URL = "postgres://test";
  });

  afterAll(() => {
    if (prevPg === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = prevPg;
  });

  beforeEach(() => {
    query = getMockPoolQuery();
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  describe("POST /api/v1/auth/key", () => {
    it("returns 503 when the database is not configured", async () => {
      delete process.env.POSTGRES_URL;
      const res = await request(app).post("/api/v1/auth/key").send({});
      expect(res.status).toBe(503);
      process.env.POSTGRES_URL = "postgres://test";
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await request(app).post("/api/v1/auth/key").send({ owner: "0x0" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for an invalid signature format", async () => {
      const wallet = ethers.Wallet.createRandom();
      const res = await request(app).post("/api/v1/auth/key").send({
        owner: wallet.address,
        signature: "0xnotasignature",
        nonce: 1,
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 when the signature does not match the owner", async () => {
      const signer = ethers.Wallet.createRandom();
      const other = ethers.Wallet.createRandom();
      const signature = await signer.signTypedData(DOMAIN, TYPES, {
        owner: ethers.getAddress(other.address.toLowerCase()),
        nonce: 1n,
      });
      const res = await request(app).post("/api/v1/auth/key").send({
        owner: other.address,
        signature,
        nonce: 1,
      });
      expect(res.status).toBe(401);
    });

    it("issues an API key for a valid signature (default FREE tier)", async () => {
      const wallet = ethers.Wallet.createRandom();
      const owner = ethers.getAddress(wallet.address.toLowerCase());
      const signature = await wallet.signTypedData(DOMAIN, TYPES, { owner, nonce: 7n });
      const res = await request(app).post("/api/v1/auth/key").send({
        owner: wallet.address,
        signature,
        nonce: 7,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.apiKey).toMatch(/^realyx_/);
      expect(res.body.tier).toBe("FREE");
      expect(query).toHaveBeenCalled();
    });

    it("honors a valid requested tier", async () => {
      const wallet = ethers.Wallet.createRandom();
      const owner = ethers.getAddress(wallet.address.toLowerCase());
      const signature = await wallet.signTypedData(DOMAIN, TYPES, { owner, nonce: 0n });
      const res = await request(app).post("/api/v1/auth/key").send({
        owner: wallet.address,
        signature,
        nonce: 0,
        tier: "pro",
      });
      expect(res.status).toBe(200);
      expect(res.body.tier).toBe("PRO");
    });

    it("returns 500 when the upsert query throws", async () => {
      query.mockRejectedValueOnce(new Error("db down"));
      const wallet = ethers.Wallet.createRandom();
      const owner = ethers.getAddress(wallet.address.toLowerCase());
      const signature = await wallet.signTypedData(DOMAIN, TYPES, { owner, nonce: 3n });
      const res = await request(app).post("/api/v1/auth/key").send({
        owner: wallet.address,
        signature,
        nonce: 3,
      });
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/v1/auth/verify", () => {
    it("returns 401 when the x-api-key header is missing", async () => {
      const res = await request(app).get("/api/v1/auth/verify");
      expect(res.status).toBe(401);
    });

    it("returns 401 for an unknown key", async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get("/api/v1/auth/verify").set("x-api-key", "realyx_abc");
      expect(res.status).toBe(401);
    });

    it("returns the owner and tier for a valid key", async () => {
      query.mockResolvedValueOnce({
        rows: [{ owner_address: "0xowner", tier: "VIP", created_at: "2024-01-01" }],
      });
      const res = await request(app).get("/api/v1/auth/verify").set("x-api-key", "realyx_abc");
      expect(res.status).toBe(200);
      expect(res.body.owner).toBe("0xowner");
      expect(res.body.tier).toBe("VIP");
    });

    it("returns 500 when the lookup query throws", async () => {
      query.mockRejectedValueOnce(new Error("db down"));
      const res = await request(app).get("/api/v1/auth/verify").set("x-api-key", "realyx_abc");
      expect(res.status).toBe(500);
    });
  });
});
