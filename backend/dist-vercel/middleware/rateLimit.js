"use strict";
/**
 * In-memory rate limiter for API and WebSocket.
 * Use redis or similar for production multi-instance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRateLimit = apiRateLimit;
exports.checkWsRateLimit = checkWsRateLimit;
exports.decrementWsCount = decrementWsCount;
const windowMs = 60_000; // 1 minute
const maxRequests = 100; // per IP per window
const maxWsPerIp = 10;
const apiCount = new Map();
const wsCount = new Map();
function getClientIp(req) {
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
function apiRateLimit(req, _res, next) {
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
        const err = new Error("Too Many Requests");
        err.status = 429;
        return next(err);
    }
    next();
}
function checkWsRateLimit(ip) {
    const n = wsCount.get(ip) ?? 0;
    if (n >= maxWsPerIp)
        return false;
    wsCount.set(ip, n + 1);
    return true;
}
function decrementWsCount(ip) {
    const n = wsCount.get(ip) ?? 0;
    if (n <= 1)
        wsCount.delete(ip);
    else
        wsCount.set(ip, n - 1);
}
