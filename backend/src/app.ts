import express from "express";
import cors from "cors";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { logger } from "./logger.js";
import marketsRouter from "./routes/markets.js";
import userRouter from "./routes/user.js";
import statsRouter from "./routes/stats.js";
import leaderboardRouter from "./routes/leaderboard.js";
import insuranceRouter from "./routes/insurance.js";
import healthRouter from "./routes/health.js";
import syncRouter from "./routes/sync.js";
import pythRefreshRouter from "./routes/pythRefresh.js";
import debugRouter from "./routes/debug.js";
import authRouter from "./routes/auth.js";
import socialRouter from "./routes/social.js";
import keeperRouter from "./routes/keeper.js";
import referralsRouter from "./routes/referrals.js";
import vaultRouter from "./routes/vault.js";
import statusRouter from "./routes/status.js";
import { broadcastKeeperFailure } from "./wsServer.js";
import { apiRateLimitCluster } from "./middleware/rateLimit.js";
import { metricsMiddleware } from "./middleware/metrics.js";

const httpLogger = (pinoHttp as unknown as (opts: { logger: pino.Logger }) => express.RequestHandler)({ logger });

/**
 * Build CORS options. By default (no CORS_ORIGINS set) all origins are allowed,
 * preserving existing behaviour for local/dev. In production, set CORS_ORIGINS
 * to a comma-separated allowlist (e.g. "https://app.realyx.example,https://realyx.example")
 * to restrict which sites may call the API from a browser.
 */
function buildCorsOptions(): cors.CorsOptions {
  const raw = (process.env.CORS_ORIGINS ?? "").trim();
  if (!raw) {
    // Reflect request origin (equivalent to the previous `origin: true`).
    return { origin: true };
  }
  const allowlist = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    origin(origin, callback) {
      // Allow same-origin / non-browser clients (no Origin header).
      if (!origin || allowlist.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
  };
}

const app = express();
// CSP/COEP are disabled because this service also serves a web3 SPA (wallet
// SDKs, external RPC/Hermes endpoints, inline bootstrap) and the prior nginx
// setup shipped no Content-Security-Policy. The other hardening headers
// (frameguard, noSniff, referrer-policy, etc.) remain enabled.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: "1mb" }));
app.use(httpLogger);
app.use(metricsMiddleware);

app.use("/health", healthRouter);
app.use(apiRateLimitCluster);

// Legacy /api/ routes (backward compatible)
app.use("/api/markets", marketsRouter);
app.use("/api/user", userRouter);
app.use("/api/stats", statsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/insurance", insuranceRouter);
app.use("/api/sync", syncRouter);
app.use("/api/pyth-refresh", pythRefreshRouter);
app.use("/api/debug", debugRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/vault", vaultRouter);
app.use("/api/status", statusRouter);

// Versioned /api/v1/ routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/markets", marketsRouter);
app.use("/api/v1/user", userRouter);
app.use("/api/v1/stats", statsRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
app.use("/api/v1/insurance", insuranceRouter);
app.use("/api/v1/sync", syncRouter);
app.use("/api/v1/pyth-refresh", pythRefreshRouter);
app.use("/api/v1/debug", debugRouter);
app.use("/api/v1/keeper", keeperRouter);
app.use("/api/v1/social", socialRouter);
app.use("/api/v1/referrals", referralsRouter);
app.use("/api/v1/vault", vaultRouter);
app.use("/api/v1/status", statusRouter);

// Attach keeper failure broadcast function for use by the keeper router
app.use((req: any, _res: any, next: any) => {
  req.app.__broadcastKeeperFailure = broadcastKeeperFailure;
  next();
});

// Unmatched API/health routes always return JSON — never the SPA shell.
app.use(["/api", "/health"], (_req: any, res: any) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// ─── Static frontend (single-service full-stack deploy) ───
// When the built frontend is shipped alongside the API (see the root
// Dockerfile), serve it from the same origin so one service/URL hosts both the
// app and the API. The SPA's client-side router owns all non-API paths, so
// unmatched routes fall back to index.html. When no build is present (API-only
// deploy) the previous JSON-404 behaviour is preserved. The runtime container's
// working directory is /app and the built SPA is copied to /app/public.
const frontendDist =
  (process.env.FRONTEND_DIST ?? "").trim() || path.resolve(process.cwd(), "public");
const hasFrontend = fs.existsSync(path.join(frontendDist, "index.html"));

if (hasFrontend) {
  app.use(express.static(frontendDist));
  app.get("*", (_req: express.Request, res: express.Response) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
  logger.info({ frontendDist }, "Serving static frontend (single-service mode)");
} else {
  app.use((_req: any, res: any) => {
    res.status(404).json({ success: false, error: "Not found" });
  });
}

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.status === 429) {
    res.status(429).json({ success: false, error: "Too many requests" });
    return;
  }
  logger.error(err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

export { app, logger };
