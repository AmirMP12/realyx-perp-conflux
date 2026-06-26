import { jest } from "@jest/globals";

/**
 * Covers the periodic cleanup() sweep that prunes expired API-count buckets and
 * tier-cache entries. It runs on a 30s interval, so we import the module under
 * fake timers and advance the clock to trigger it with both expired and
 * still-fresh entries present.
 */
describe("rateLimit cleanup sweep", () => {
  const OLD = { ...process.env };

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...OLD };
  });

  it("prunes expired entries on the interval while keeping fresh ones", async () => {
    jest.useFakeTimers();
    await jest.isolateModulesAsync(async () => {
      const rl = await import("../middleware/rateLimit.js");
      const next = jest.fn();
      const res = { status: () => ({ json: () => undefined }) };

      // Create an apiCount bucket (resetAt = now + 60s).
      rl.apiRateLimit({ ip: "1.2.3.4", headers: {} } as any, res as any, next);

      // Before expiry: cleanup runs at 30s, the bucket (resetAt 60s) survives.
      jest.advanceTimersByTime(30_000);
      // After expiry: advance well past the window so the next sweep prunes it.
      jest.advanceTimersByTime(60_000);

      // A fresh request creates a new bucket that should survive the next sweep.
      rl.apiRateLimit({ ip: "5.6.7.8", headers: {} } as any, res as any, next);
      jest.advanceTimersByTime(30_000);

      expect(next).toHaveBeenCalled();
    });
  });

  it("prunes expired tier-cache entries on the interval", async () => {
    jest.useFakeTimers();
    process.env.POSTGRES_URL = "postgres://test";
    await jest.isolateModulesAsync(async () => {
      const rl = await import("../middleware/rateLimit.js");
      const res = { status: () => ({ json: () => undefined }) };

      // An authenticated request warms the tier cache in the background
      // (warmTier -> pool.query resolves via the global pg mock and sets a
      // tierCache entry with a 5-minute TTL).
      rl.apiRateLimit(
        { ip: "1.1.1.1", headers: { "x-api-key": "realyx_expiring_key" } } as any,
        res as any,
        jest.fn(),
      );

      // Flush the background query's microtasks so the tier entry is cached.
      await Promise.resolve();
      await Promise.resolve();

      // Advance past the 5-minute tier TTL so the next 30s sweep deletes it.
      jest.advanceTimersByTime(300_000 + 30_000);

      // A follow-up request must still succeed after the sweep.
      const next = jest.fn();
      rl.apiRateLimit(
        { ip: "1.1.1.1", headers: { "x-api-key": "realyx_expiring_key" } } as any,
        res as any,
        next,
      );
      expect(next).toHaveBeenCalled();
    });
  });
});
