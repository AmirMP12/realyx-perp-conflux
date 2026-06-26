import {
  initCacheBackend,
  cacheGet,
  cacheSet,
  __resetCacheForTests,
} from "../services/cache.js";

describe("cache service (extended)", () => {
  const prevRedis = process.env.REDIS_URL;

  beforeEach(() => {
    __resetCacheForTests();
  });

  afterAll(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  describe("initCacheBackend", () => {
    it("is a no-op when REDIS_URL is not set", async () => {
      delete process.env.REDIS_URL;
      await expect(initCacheBackend()).resolves.toBeUndefined();
      // Memory backend still works.
      await cacheSet("k", 1, 1000);
      expect(await cacheGet("k")).toBe(1);
    });

    it("falls back to the in-memory backend when ioredis is unavailable", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      // 'ioredis' is not installed → the dynamic import resolves to null and we
      // keep the in-memory backend instead of throwing.
      await expect(initCacheBackend()).resolves.toBeUndefined();
      await cacheSet("k2", "v2", 1000);
      expect(await cacheGet("k2")).toBe("v2");
    });

    it("only attempts initialization once per process", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      await initCacheBackend();
      // Second call short-circuits via the redisInitTried guard.
      await expect(initCacheBackend()).resolves.toBeUndefined();
    });
  });

  describe("LRU eviction", () => {
    it("re-inserts an existing key on set (overwrite path)", async () => {
      await cacheSet("dup", 1, 60_000);
      await cacheSet("dup", 2, 60_000); // store.has(key) === true → delete then re-set
      expect(await cacheGet("dup")).toBe(2);
    });

    it("evicts the oldest entries beyond the max size", async () => {
      // Default MemoryCache holds 500 entries; insert more to force eviction.
      for (let i = 0; i < 510; i++) {
        await cacheSet(`key-${i}`, i, 60_000);
      }
      // The earliest keys should have been evicted.
      expect(await cacheGet("key-0")).toBeUndefined();
      // Recent keys remain.
      expect(await cacheGet("key-509")).toBe(509);
    });

    it("bumps recently-read keys so they survive eviction (LRU)", async () => {
      for (let i = 0; i < 500; i++) {
        await cacheSet(`k-${i}`, i, 60_000);
      }
      // Touch the oldest key so it becomes most-recently-used.
      expect(await cacheGet("k-0")).toBe(0);
      // Insert one more, evicting the now-oldest (k-1) rather than k-0.
      await cacheSet("k-500", 500, 60_000);
      expect(await cacheGet("k-0")).toBe(0);
      expect(await cacheGet("k-1")).toBeUndefined();
    });
  });
});
