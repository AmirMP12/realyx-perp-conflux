/**
 * Shared read-through cache for hot, user-agnostic endpoints (markets, stats).
 *
 * These responses are read-heavy and identical across all users, so serving
 * them from a short-TTL cache removes the bulk of repeated DB/RPC work under
 * load. The cache is an in-process TTL + LRU store by default (zero extra
 * infra). When `REDIS_URL` is set and the optional `ioredis` package is
 * installed, a Redis backend is used instead so the cache is shared across
 * server replicas; if the package is missing we degrade gracefully to memory.
 *
 * `getOrSet` also performs single-flight de-duplication: concurrent misses for
 * the same key share one loader call instead of stampeding the DB/RPC.
 */

import { logger } from "../logger.js";

interface Entry {
    value: unknown;
    expiresAt: number;
}export interface CacheBackend {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttlMs: number): Promise<void>;
    del(key: string): Promise<void>;
    clear(): Promise<void>;
}

/** In-process TTL store with LRU eviction. Safe default for single-instance. */
class MemoryCache implements CacheBackend {
    private store = new Map<string, Entry>();
    constructor(private maxEntries = 500) {}

    async get<T>(key: string): Promise<T | undefined> {
        const e = this.store.get(key);
        if (!e) return undefined;
        if (e.expiresAt <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        // LRU bump: re-insert to mark most-recently-used.
        this.store.delete(key);
        this.store.set(key, e);
        return e.value as T;
    }

    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
        if (this.store.has(key)) this.store.delete(key);
        this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
        while (this.store.size > this.maxEntries) {
            const oldest = this.store.keys().next().value;
            if (oldest === undefined) break;
            this.store.delete(oldest);
        }
    }

    async del(key: string): Promise<void> {
        this.store.delete(key);
    }

    async clear(): Promise<void> {
        this.store.clear();
    }
}

let backend: CacheBackend = new MemoryCache();
let redisInitTried = false;
/** Raw Redis client when the Redis backend is active (for atomic ops like INCR). */
let redisClient: { incr(k: string): Promise<number>; pexpire(k: string, ms: number): Promise<unknown> } | null = null;

/**
 * Best-effort Redis wiring. Only attempts when REDIS_URL is set. A missing
 * `ioredis` dependency or connection failure leaves the in-memory backend in
 * place rather than throwing — caching is an optimization, never a hard
 * dependency.
 */
export async function initCacheBackend(): Promise<void> {
    if (redisInitTried) return;
    redisInitTried = true;
    const url = (process.env.REDIS_URL ?? "").trim();
    if (!url) return;
    try {
        // Optional dependency: import by a computed specifier so tsc doesn't
        // hard-require the module (it may not be installed) and bundlers don't
        // try to resolve it at build time.
        const specifier = "ioredis";
        const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier).catch(() => null);
        const Redis = (mod as any)?.default ?? (mod as any);
        if (!Redis) {
            logger.warn("[cache] REDIS_URL set but 'ioredis' not installed; using in-memory cache");
            return;
        }
        const client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
        redisClient = client;
        backend = {
            async get<T>(key: string): Promise<T | undefined> {
                const raw = await client.get(key);
                return raw == null ? undefined : (JSON.parse(raw) as T);
            },
            async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
                await client.set(key, JSON.stringify(value), "PX", ttlMs);
            },
            async del(key: string): Promise<void> {
                await client.del(key);
            },
            async clear(): Promise<void> {
                await client.flushdb();
            },
        };
        logger.info("[cache] Using Redis backend");
    } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : e }, "[cache] Redis init failed; using in-memory cache");
    }
}

const inflight = new Map<string, Promise<unknown>>();

export async function cacheGet<T>(key: string): Promise<T | undefined> {
    try {
        return await backend.get<T>(key);
    } catch {
        return undefined;
    }
}

export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
        await backend.set(key, value, ttlMs);
    } catch {
        /* cache write failures must never break a request */
    }
}

export async function cacheDel(key: string): Promise<void> {
    try {
        await backend.del(key);
    } catch {
        /* noop */
    }
}

export async function cacheClear(): Promise<void> {
    inflight.clear();
    try {
        await backend.clear();
    } catch {
        /* noop */
    }
}

/**
 * Read-through with single-flight. On a hit returns the cached value; on a miss
 * runs `loader` once (shared across concurrent callers) and caches the result.
 * If `loader` throws, nothing is cached and the error propagates to the caller.
 */
export async function cacheGetOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const hit = await cacheGet<T>(key);
    if (hit !== undefined) return hit;

    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
        const value = await loader();
        await cacheSet(key, value, ttlMs);
        return value;
    })();
    inflight.set(key, p);
    try {
        return await p;
    } finally {
        inflight.delete(key);
    }
}

/** True when the shared Redis backend is active (enables cluster-wide ops). */
export function isRedisActive(): boolean {
    return redisClient != null;
}

/**
 * Atomic counter increment with a window TTL, used for cluster-wide rate
 * limiting. Returns the new count, or null when Redis isn't active / errored
 * (callers then fall back to per-process limiting). The TTL is only set on the
 * first increment of a window so the window slides correctly.
 */
export async function cacheIncr(key: string, windowMs: number): Promise<number | null> {
    if (!redisClient) return null;
    try {
        const n = await redisClient.incr(key);
        if (n === 1) await redisClient.pexpire(key, windowMs);
        return n;
    } catch {
        return null;
    }
}

/** Test/maintenance helper: reset to a fresh in-memory backend. */
export function __resetCacheForTests(): void {
    backend = new MemoryCache();
    redisInitTried = false;
    redisClient = null;
    inflight.clear();
}
