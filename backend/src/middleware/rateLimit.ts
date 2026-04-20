/**
 * In-memory rate limiter for API and WebSocket.
 * Use redis or similar for production multi-instance.
 */

const windowMs = 60_000; // 1 minute
const maxRequests = 100; // per IP per window
const maxWsPerIp = 10;

const apiCount = new Map<string, { count: number; resetAt: number }>();
const wsCount = new Map<string, number>();

export function getClientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  if (Array.isArray(forwarded)) return forwarded[0] ?? "unknown";
  return req.ip ?? "unknown";
}

function cleanup() {
  const now = Date.now();
  for (const [key, v] of apiCount.entries()) {
    if (v.resetAt < now) apiCount.delete(key);
  }
}
setInterval(cleanup, 30_000).unref();

export function apiRateLimit(
  req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  _res: unknown,
  next: (err?: unknown) => void
) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = apiCount.get(ip);
  if (!entry) {
    apiCount.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (entry.resetAt < now) {
    apiCount.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  entry.count++;
  if (entry.count > maxRequests) {
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
