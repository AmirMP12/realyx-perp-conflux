import { jest } from "@jest/globals";

/**
 * Tests apiRateLimitCluster — the Redis-backed, cluster-wide limiter. The
 * cache module is mocked so we can drive isRedisActive()/cacheIncr() and
 * cover each scenario: Redis-inactive fallback, per-IP and per-key buckets,
 * the 429 paths (with and without res.status), the null/error fall-throughs to
 * the in-memory limiter, and the catch-all safety net.
 */

const isRedisActive = jest.fn<() => boolean>();
const cacheIncr = jest.fn<(key: string, windowMs: number) => Promise<number | null>>();

jest.mock("../services/cache.js", () => ({
  __esModule: true,
  isRedisActive: (...args: unknown[]) => (isRedisActive as any)(...args),
  cacheIncr: (...args: unknown[]) => (cacheIncr as any)(...args),
}));

import { apiRateLimitCluster } from "../middleware/rateLimit.js";

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as any;
}

describe("apiRateLimitCluster", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    isRedisActive.mockReset();
    cacheIncr.mockReset();
    process.env.POSTGRES_URL = "postgres://test";
  });

  afterEach(() => {
    process.env = { ...OLD };
  });

  it("falls back to the in-memory limiter when Redis is inactive", async () => {
    isRedisActive.mockReturnValue(false);
    const next = jest.fn();
    await apiRateLimitCluster({ ip: "9.9.9.1", headers: {} } as any, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(cacheIncr).not.toHaveBeenCalled();
  });

  it("allows an under-limit request bucketed per IP", async () => {
    isRedisActive.mockReturnValue(true);
    cacheIncr.mockResolvedValue(1);
    const next = jest.fn();
    await apiRateLimitCluster({ ip: "9.9.9.2", headers: {} } as any, makeRes(), next);
    expect(cacheIncr).toHaveBeenCalledWith(expect.stringContaining("rl:ip:9.9.9.2"), 60_000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("resolves a per-key tier bucket when an api key is present", async () => {
    isRedisActive.mockReturnValue(true);
    cacheIncr.mockResolvedValue(5);
    const next = jest.fn();
    await apiRateLimitCluster(
      { ip: "9.9.9.3", headers: { "x-api-key": "realyx_cluster_key" } } as any,
      makeRes(),
      next,
    );
    expect(cacheIncr).toHaveBeenCalledWith(expect.stringContaining("rl:key:"), 60_000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 via res.status when over the limit", async () => {
    isRedisActive.mockReturnValue(true);
    cacheIncr.mockResolvedValue(101);
    const res = makeRes();
    const next = jest.fn();
    await apiRateLimitCluster({ ip: "9.9.9.4", headers: {} } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes a 429 error to next when res.status is unavailable", async () => {
    isRedisActive.mockReturnValue(true);
    cacheIncr.mockResolvedValue(101);
    const next = jest.fn();
    await apiRateLimitCluster({ ip: "9.9.9.5", headers: {} } as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].status).toBe(429);
  });

  it("falls back to the in-memory limiter when cacheIncr returns null", async () => {
    isRedisActive.mockReturnValue(true);
    cacheIncr.mockResolvedValue(null);
    const next = jest.fn();
    await apiRateLimitCluster({ ip: "9.9.9.6", headers: {} } as any, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("falls back to the in-memory limiter when cacheIncr throws", async () => {
    isRedisActive.mockReturnValue(true);
    cacheIncr.mockRejectedValue(new Error("redis blip"));
    const next = jest.fn();
    await apiRateLimitCluster({ ip: "9.9.9.7", headers: {} } as any, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
