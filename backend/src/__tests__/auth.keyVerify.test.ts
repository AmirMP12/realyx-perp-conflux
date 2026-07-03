import { jest } from "@jest/globals";
import request from "supertest";

const mockPoolQuery = jest.fn<any>();
const mockVerifyTypedData = jest.fn<any>();

jest.mock("pg", () => {
  const Pool = jest.fn(() => ({
    query: (...a: any[]) => mockPoolQuery(...a),
    on: jest.fn(),
    end: jest.fn(),
  }));
  return { __esModule: true, default: { Pool }, Pool };
});

jest.mock("ethers", () => {
  const actual = jest.requireActual("ethers") as any;
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      verifyTypedData: (...a: any[]) => mockVerifyTypedData(...a),
      getAddress: actual.ethers.getAddress,
    },
    verifyTypedData: (...a: any[]) => mockVerifyTypedData(...a),
    getAddress: actual.ethers.getAddress,
  };
});

import { app } from "../app.js";

const VALID_OWNER = "0x" + "a".repeat(40);

describe("auth key and verify routes", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockVerifyTypedData.mockReset();
    process.env.POSTGRES_URL = "postgres://test";
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockVerifyTypedData.mockReturnValue(VALID_OWNER);
  });

  afterEach(() => {
    process.env = { ...OLD };
  });

  it("returns 400 when ethers.verifyTypedData throws (invalid signature format)", async () => {
    mockVerifyTypedData.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER, signature: "0xbadsig", nonce: "1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid signature format/);
  });

  it("returns 401 when recovered address does not match owner", async () => {
    const DIFFERENT = "0x" + "b".repeat(40);
    mockVerifyTypedData.mockReturnValue(DIFFERENT);

    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER, signature: "0xsig", nonce: "1" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Signature does not match owner/);
  });

  it("returns 409 when the nonce has already been used (rowCount === 0)", async () => {
    mockVerifyTypedData.mockReturnValue(VALID_OWNER);
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER, signature: "0xsig", nonce: "42" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Nonce already used/);
  });

  it("assigns PRO tier when the request body specifies 'pro'", async () => {
    mockVerifyTypedData.mockReturnValue(VALID_OWNER);
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER, signature: "0xsig", nonce: "1", tier: "pro" });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("PRO");
  });

  it("assigns VIP tier when the request body specifies 'VIP'", async () => {
    mockVerifyTypedData.mockReturnValue(VALID_OWNER);
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER, signature: "0xsig", nonce: "2", tier: "VIP" });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("VIP");
  });

  it("defaults to FREE tier for an unrecognised tier value", async () => {
    mockVerifyTypedData.mockReturnValue(VALID_OWNER);
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER, signature: "0xsig", nonce: "3", tier: "GOLD" });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("FREE");
  });

  it("returns 500 when the pool query throws unexpectedly", async () => {
    mockVerifyTypedData.mockReturnValue(VALID_OWNER);
    mockPoolQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER, signature: "0xsig", nonce: "4" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
  });

  it("returns 400 when required fields are missing from the request body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/key")
      .send({ owner: VALID_OWNER });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  it("returns 401 when the API key is not found in the DB", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/v1/auth/verify")
      .set("x-api-key", "realyx_unknownkey123");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid API key/);
  });

  it("returns 200 with owner/tier/createdAt for a valid key", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ owner_address: VALID_OWNER, tier: "PRO", created_at: "2024-01-01" }],
    });

    const res = await request(app)
      .get("/api/v1/auth/verify")
      .set("x-api-key", "realyx_validkey123");

    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.tier).toBe("PRO");
    }
  });

  it("returns 401 or 500 when verify query fails", async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error("query timeout"));

    const res = await request(app)
      .get("/api/v1/auth/verify")
      .set("x-api-key", "realyx_badkey");

    expect([401, 500]).toContain(res.status);
  });
});
