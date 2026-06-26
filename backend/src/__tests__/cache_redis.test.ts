import { jest } from "@jest/globals";

// Virtual mock for the optional `ioredis` dependency (not installed).
const redisStore = new Map<string, string>();
const client = {
  get: jest.fn(async (k: string) => (redisStore.has(k) ? redisStore.get(k)! : null)),
  set: jest.fn(async (k: string, v: string) => { redisStore.set(k, v); }),
  del: jest.fn(async (k: string) => { redisStore.delete(k); }),
  flushdb: jest.fn(async () => { redisStore.clear(); }),
  incr: jest.fn(async (_k: string) => 1),
  pexpire: jest.fn(async (_k: string, _ms: number) => 1),
};
const RedisCtor = jest.fn(() => client);

jest.mock("ioredis", () => ({ __esModule: true, default: RedisCtor }), { virtual: true });

import {
  initCacheBackend,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheClear,
  cacheIncr,
  isRedisActive,
  __resetCacheForTests,
} from "../services/cache.js";

describe("cache Redis backend", () => {
  const prevRedis = process.env.REDIS_URL;

  beforeEach(() => {
    __resetCacheForTests();
    redisStore.clear();
    RedisCtor.mockClear();
    client.get.mockClear();
    client.set.mockClear();
    client.del.mockClear();
    client.flushdb.mockClear();
    client.incr.mockClear();
    client.pexpire.mockClear();
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterAll(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("initializes the Redis backend and routes operations through the client", async () => {
    await initCacheBackend();
    expect(RedisCtor).toHaveBeenCalledWith("redis://localhost:6379", expect.any(Object));

    await cacheSet("k", { a: 1 }, 1000);
    expect(client.set).toHaveBeenCalledWith("k", JSON.stringify({ a: 1 }), "PX", 1000);

    const got = await cacheGet<{ a: number }>("k");
    expect(got).toEqual({ a: 1 });
    expect(client.get).toHaveBeenCalledWith("k");

    await cacheDel("k");
    expect(client.del).toHaveBeenCalledWith("k");

    await cacheClear();
    expect(client.flushdb).toHaveBeenCalled();
  });

  it("returns undefined from the Redis backend when a key is missing", async () => {
    await initCacheBackend();
    const got = await cacheGet("absent");
    expect(got).toBeUndefined();
  });

  it("swallows backend errors across all cache operations", async () => {
    client.get.mockRejectedValueOnce(new Error("get fail"));
    client.set.mockRejectedValueOnce(new Error("set fail"));
    client.del.mockRejectedValueOnce(new Error("del fail"));
    client.flushdb.mockRejectedValueOnce(new Error("flush fail"));
    await initCacheBackend();
    expect(await cacheGet("k")).toBeUndefined();
    await expect(cacheSet("k", 1, 1000)).resolves.toBeUndefined();
    await expect(cacheDel("k")).resolves.toBeUndefined();
    await expect(cacheClear()).resolves.toBeUndefined();
  });

  describe("isRedisActive / cacheIncr", () => {
    it("reports Redis active only after a successful init", async () => {
      expect(isRedisActive()).toBe(false);
      await initCacheBackend();
      expect(isRedisActive()).toBe(true);
      __resetCacheForTests();
      expect(isRedisActive()).toBe(false);
    });

    it("increments and sets the window TTL on the first hit", async () => {
      await initCacheBackend();
      client.incr.mockResolvedValueOnce(1);
      const n = await cacheIncr("rl:bucket", 60_000);
      expect(n).toBe(1);
      expect(client.incr).toHaveBeenCalledWith("rl:bucket");
      expect(client.pexpire).toHaveBeenCalledWith("rl:bucket", 60_000);
    });

    it("does not reset the TTL on subsequent hits in the window", async () => {
      await initCacheBackend();
      client.incr.mockResolvedValueOnce(2);
      const n = await cacheIncr("rl:bucket", 60_000);
      expect(n).toBe(2);
      expect(client.pexpire).not.toHaveBeenCalled();
    });

    it("returns null when Redis is not active", async () => {
      // No init: redisClient stays null.
      expect(await cacheIncr("rl:bucket", 60_000)).toBeNull();
    });

    it("returns null when the increment throws", async () => {
      await initCacheBackend();
      client.incr.mockRejectedValueOnce(new Error("incr fail"));
      expect(await cacheIncr("rl:bucket", 60_000)).toBeNull();
    });
  });
});
