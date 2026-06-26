import {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheClear,
  cacheGetOrSet,
  __resetCacheForTests,
} from "../services/cache.js";

describe("cache service (in-memory backend)", () => {
  beforeEach(() => {
    __resetCacheForTests();
  });

  it("returns undefined for a missing key", async () => {
    expect(await cacheGet("nope")).toBeUndefined();
  });

  it("stores and retrieves a value within TTL", async () => {
    await cacheSet("k", { a: 1 }, 1000);
    expect(await cacheGet("k")).toEqual({ a: 1 });
  });

  it("expires values after the TTL", async () => {
    await cacheSet("k", "v", 5);
    await new Promise((r) => setTimeout(r, 15));
    expect(await cacheGet("k")).toBeUndefined();
  });

  it("deletes a key", async () => {
    await cacheSet("k", "v", 1000);
    await cacheDel("k");
    expect(await cacheGet("k")).toBeUndefined();
  });

  it("clears all keys", async () => {
    await cacheSet("a", 1, 1000);
    await cacheSet("b", 2, 1000);
    await cacheClear();
    expect(await cacheGet("a")).toBeUndefined();
    expect(await cacheGet("b")).toBeUndefined();
  });

  describe("getOrSet", () => {
    it("invokes the loader on a miss and caches the result", async () => {
      const loader = jest.fn(async () => "computed");
      const first = await cacheGetOrSet("key", 1000, loader);
      const second = await cacheGetOrSet("key", 1000, loader);
      expect(first).toBe("computed");
      expect(second).toBe("computed");
      expect(loader).toHaveBeenCalledTimes(1); // second served from cache
    });

    it("de-duplicates concurrent misses into a single loader call (single-flight)", async () => {
      let calls = 0;
      const loader = async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return calls;
      };
      const [a, b, c] = await Promise.all([
        cacheGetOrSet("same", 1000, loader),
        cacheGetOrSet("same", 1000, loader),
        cacheGetOrSet("same", 1000, loader),
      ]);
      expect(calls).toBe(1);
      expect([a, b, c]).toEqual([1, 1, 1]);
    });

    it("does not cache when the loader throws and surfaces the error", async () => {
      await expect(
        cacheGetOrSet("err", 1000, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // A subsequent successful loader should run (nothing was cached).
      const ok = await cacheGetOrSet("err", 1000, async () => "recovered");
      expect(ok).toBe("recovered");
    });
  });
});
