import { jest } from "@jest/globals";
import { apiRateLimit, resolveTier, TIER_LIMITS } from "../middleware/rateLimit.js";

describe("Rate Limit Tiering", () => {
  it("defines higher limits for PRO and VIP than FREE", () => {
    expect(TIER_LIMITS.PRO).toBeGreaterThan(TIER_LIMITS.FREE);
    expect(TIER_LIMITS.VIP).toBeGreaterThan(TIER_LIMITS.PRO);
  });

  it("resolveTier falls back to FREE for no key", async () => {
    expect(await resolveTier(undefined)).toBe("FREE");
  });

  it("resolveTier falls back to FREE when DB returns no rows", async () => {
    // The global pg mock resolves to { rows: [] }.
    expect(await resolveTier("realyx_unknownkey")).toBe("FREE");
  });

  it("buckets requests per API key, isolating different keys", () => {
    const headersA = { "x-api-key": "realyx_keyA_unique" };
    const headersB = { "x-api-key": "realyx_keyB_unique" };
    const next = jest.fn();
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    // Exhaust FREE limit (100) for key A from a shared IP.
    for (let i = 0; i < 101; i++) {
      apiRateLimit({ ip: "10.0.0.1", headers: headersA } as any, res, next);
    }
    expect(res.status).toHaveBeenCalledWith(429);

    // Key B (same IP) should still pass — buckets are per key, not per IP.
    res.status.mockClear();
    apiRateLimit({ ip: "10.0.0.1", headers: headersB } as any, res, next);
    expect(res.status).not.toHaveBeenCalledWith(429);
  });
});
