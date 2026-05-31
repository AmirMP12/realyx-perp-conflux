/**
 * Tiered in-memory rate limiter for API and WebSocket.
 *
 * Supports the `x-api-key` header with dynamic thresholds based on tier.
 * Tier is resolved from the database and cached in-memory (5 min TTL). The
 * resolution is non-blocking: the first request for an unseen key is treated as
 * FREE while the lookup is kicked off in the background, and subsequent requests
 * use the cached tier. This keeps the middleware synchronous (Express style)
 * while still honouring elevated PRO/VIP limits.
 *
 * NOTE: state is per-process. For multi-instance deployments use a shared store
 * (Redis) so limits are enforced cluster-wide.
 */
import crypto from "crypto";
import pg from "pg";
const windowMs = 60_000; // 1 minute
// Default rate limits per tier (requests per minute)
const TIER_LIMITS = {
    FREE: 100,
    PRO: 10_000,
    VIP: 50_000,
};
const maxWsPerIp = 10;
const apiCount = new Map();
const wsCount = new Map();
// Cache for API key tier lookups (5 min TTL)
const tierCache = new Map();
const TIER_CACHE_TTL = 300_000; // 5 minutes
// Tracks in-flight tier lookups so we don't hammer the DB for the same key.
const tierInflight = new Set();
let poolInstance = null;
function getPool() {
    if (poolInstance)
        return poolInstance;
    if (!process.env.POSTGRES_URL)
        return null;
    poolInstance = new pg.Pool({
        connectionString: process.env.POSTGRES_URL,
        ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 3_000,
    });
    return poolInstance;
}
export function getClientIp(req) {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string")
        return forwarded.split(",")[0]?.trim() ?? "unknown";
    if (Array.isArray(forwarded))
        return forwarded[0] ?? "unknown";
    return req.ip ?? "unknown";
}
function hashKey(apiKey) {
    return crypto.createHash("sha256").update(apiKey).digest("hex");
}
/** Synchronously return the cached tier for a key hash, or undefined if cold. */
function getCachedTier(hash) {
    const cached = tierCache.get(hash);
    if (cached && cached.expiresAt > Date.now())
        return cached.tier;
    return undefined;
}
/** Kick off a background DB lookup to warm the tier cache (deduplicated). */
function warmTier(apiKey, hash) {
    if (tierInflight.has(hash))
        return;
    const pool = getPool();
    if (!pool)
        return;
    tierInflight.add(hash);
    pool
        .query(`SELECT tier FROM api_keys WHERE key_hash = $1`, [hash])
        .then((result) => {
        const tier = result.rows.length > 0 ? result.rows[0].tier : "FREE";
        tierCache.set(hash, { tier, expiresAt: Date.now() + TIER_CACHE_TTL });
    })
        .catch(() => {
        /* leave cold; will retry on next request */
    })
        .finally(() => {
        tierInflight.delete(hash);
    });
}
/** Resolve a tier from an API key, with in-memory caching. Falls back to "FREE". */
async function resolveTier(apiKey) {
    if (!apiKey)
        return "FREE";
    const hash = hashKey(apiKey);
    const cached = getCachedTier(hash);
    if (cached)
        return cached;
    const pool = getPool();
    if (!pool)
        return "FREE";
    try {
        const result = await pool.query(`SELECT tier FROM api_keys WHERE key_hash = $1`, [hash]);
        const tier = result.rows.length > 0 ? result.rows[0].tier : "FREE";
        tierCache.set(hash, { tier, expiresAt: Date.now() + TIER_CACHE_TTL });
        return tier;
    }
    catch {
        return "FREE";
    }
}
function cleanup() {
    const now = Date.now();
    for (const [key, v] of apiCount.entries()) {
        if (v.resetAt < now)
            apiCount.delete(key);
    }
    for (const [key, v] of tierCache.entries()) {
        if (v.expiresAt < now)
            tierCache.delete(key);
    }
}
setInterval(cleanup, 30_000).unref();
export function apiRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const apiKey = req.headers?.["x-api-key"];
    // Determine the rate-limit bucket and applicable tier limit.
    // - Authenticated requests are bucketed per API key so one user's traffic
    //   does not exhaust a shared NAT/proxy IP bucket.
    // - The tier limit is read synchronously from the warm cache; on a cold cache
    //   we use FREE and warm it in the background for subsequent requests.
    let bucketKey;
    let limit = TIER_LIMITS.FREE;
    if (apiKey) {
        const hash = hashKey(apiKey);
        bucketKey = `key:${hash}`;
        const tier = getCachedTier(hash);
        if (tier) {
            limit = TIER_LIMITS[tier] ?? TIER_LIMITS.FREE;
        }
        else {
            warmTier(apiKey, hash);
        }
    }
    else {
        bucketKey = `ip:${ip}`;
    }
    const now = Date.now();
    const entry = apiCount.get(bucketKey);
    if (!entry || entry.resetAt < now) {
        apiCount.set(bucketKey, { count: 1, resetAt: now + windowMs });
        return next();
    }
    entry.count++;
    if (entry.count > limit) {
        const r = res;
        if (typeof r?.status === "function") {
            r.status(429).json({ success: false, error: "Too many requests" });
            return;
        }
        const err = new Error("Too Many Requests");
        err.status = 429;
        return next(err);
    }
    next();
}
export function checkWsRateLimit(ip) {
    const n = wsCount.get(ip) ?? 0;
    if (n >= maxWsPerIp)
        return false;
    wsCount.set(ip, n + 1);
    return true;
}
export function decrementWsCount(ip) {
    const n = wsCount.get(ip) ?? 0;
    if (n <= 1)
        wsCount.delete(ip);
    else
        wsCount.set(ip, n - 1);
}
// Export for auth route
export { getPool, resolveTier, TIER_LIMITS };
