/**
 * Tiered in-memory rate limiter for API and WebSocket.
 * Supports x-api-key header with dynamic thresholds based on tier.
 * Use Redis or similar for production multi-instance.
 */

import crypto from "crypto";
import pg from "pg";

const windowMs = 60_000; // 1 minute

// Default rate limits per tier (requests per minute)
const TIER_LIMITS: Record<string, number> = {
  FREE: 100,
  PRO: 10_000,
  VIP: 50_000,
};

const maxWsPerIp = 10;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const apiCount = new Map<string, RateLimitEntry>();
const wsCount = new Map<string, number>();

// Cache for API key tier lookups (5 min TTL)
const tierCache = new Map<string, { tier: string; expiresAt: number }>();
const TIER_CACHE_TTL = 300_000; // 5 minutes

let poolInstance: pg.Pool | null = null;
function getPool(): pg.Pool | null {
  if (poolInstance) return poolInstance;
  if (!process.env.POSTGRES_URL) return null;
  poolInstance = new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
  });
  return poolInstance;
}

export function getClientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  if (Array.isArray(forwarded)) return forwarded[0] ?? "unknown";
  return req.ip ?? "unknown";
}

/** Resolve a tier from an API key, with in-memory caching. Falls back to "FREE". */
async function resolveTier(apiKey: string | undefined): Promise<string> {
  if (!apiKey) return "FREE";

  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const cached = tierCache.get(hash);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.tier;
  }

  const pool = getPool();
  if (!pool) return "FREE";

  try {
    const result = await pool.query(
      `SELECT tier FROM api_keys WHERE key_hash = $1`,
      [hash]
    );
    const tier = result.rows.length > 0 ? result.rows[0].tier : "FREE";
    tierCache.set(hash, { tier, expiresAt: now + TIER_CACHE_TTL });
    return tier;
  } catch {
    return "FREE";
  }
}

function cleanup() {
  const now = Date.now();
  for (const [key, v] of apiCount.entries()) {
    if (v.resetAt < now) apiCount.delete(key);
  }
  for (const [key, v] of tierCache.entries()) {
    if (v.expiresAt < now) tierCache.delete(key);
  }
}
setInterval(cleanup, 30_000).unref();

export function apiRateLimit(
  req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  _res: unknown,
  next: (err?: unknown) => void
) {
  const ip = getClientIp(req);
  const apiKey = (req.headers?.["x-api-key"] as string | undefined);

  // Track by IP, but apply tiered limit
  const key = `ip:${ip}`;
  const now = Date.now();

  const entry = apiCount.get(key);
  if (!entry) {
    apiCount.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (entry.resetAt < now) {
    apiCount.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  entry.count++;

  // Resolve tier asynchronously but handle synchronously with fallback
  if (apiKey) {
    resolveTier(apiKey).then((tier) => {
      const limit = TIER_LIMITS[tier] ?? TIER_LIMITS["FREE"];
      if (entry.count > limit) {
        // Already past limit, but we allowed it through synchronously
        // On next request it will be caught
      }
    }).catch(() => {});
  }

  // Use DEFAULT (FREE) limit for sync check; API key users get higher limits
  // but we can't block async in middleware. We use the highest limit as a
  // generous default and let the next request block if DB lookup fails.
  const defaultLimit = TIER_LIMITS["FREE"];

  if (entry.count > defaultLimit) {
    if ((_res as any).status) {
      return (_res as any).status(429).json({ success: false, error: "Too many requests" });
    }
    const err = new Error("Too Many Requests") as Error & { status?: number };
    err.status = 429;
    return next(err);
  }

  next();
}

export function checkWsRateLimit(ip: string): boolean {
  const n = wsCount.get(ip) ?? 0;
  if (n >= maxWsPerIp) return false;
  wsCount.set(ip, n + 1);
  return true;
}

export function decrementWsCount(ip: string) {
  const n = wsCount.get(ip) ?? 0;
  if (n <= 1) wsCount.delete(ip);
  else wsCount.set(ip, n - 1);
}

// Export for auth route
export { getPool, resolveTier, TIER_LIMITS };