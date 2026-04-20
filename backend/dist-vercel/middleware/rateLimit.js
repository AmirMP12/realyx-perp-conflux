/**
 * In-memory rate limiter for API and WebSocket.
 * Use redis or similar for production multi-instance.
 */
const windowMs = 60_000; // 1 minute
const maxRequests = 100; // per IP per window
const maxWsPerIp = 10;
const apiCount = new Map();
const wsCount = new Map();
export function getClientIp(req) {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string")
        return forwarded.split(",")[0]?.trim() ?? "unknown";
    if (Array.isArray(forwarded))
        return forwarded[0] ?? "unknown";
    return req.ip ?? "unknown";
}
function cleanup() {
    const now = Date.now();
    for (const [key, v] of apiCount.entries()) {
        if (v.resetAt < now)
            apiCount.delete(key);
    }
}
setInterval(cleanup, 30_000).unref();
export function apiRateLimit(req, _res, next) {
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
        if (_res.status) {
            return _res.status(429).json({ success: false, error: "Too many requests" });
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
