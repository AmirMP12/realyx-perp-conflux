import express from "express";
import cors from "cors";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import { config } from "./config.js";
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
import keeperRouter from "./routes/keeper.js";
import { broadcastKeeperFailure } from "./wsServer.js";
import { apiRateLimit } from "./middleware/rateLimit.js";
import { metricsMiddleware } from "./middleware/metrics.js";

const logger = pino({
  level:
    config.nodeEnv === "test"
      ? "silent"
      : config.nodeEnv === "development"
        ? "debug"
        : "info",
});
const httpLogger = (pinoHttp as unknown as (opts: { logger: pino.Logger }) => express.RequestHandler)({ logger });

const app = express();
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json());
app.use(httpLogger);
app.use(metricsMiddleware);

app.use("/health", healthRouter);
app.use(apiRateLimit);

// Legacy /api/ routes (backward compatible)
app.use("/api/markets", marketsRouter);
app.use("/api/user", userRouter);
app.use("/api/stats", statsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/insurance", insuranceRouter);
app.use("/api/sync", syncRouter);
app.use("/api/pyth-refresh", pythRefreshRouter);
app.use("/api/debug", debugRouter);

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

// Attach keeper failure broadcast function for use by the keeper router
app.use((req: any, _res: any, next: any) => {
  req.app.__broadcastKeeperFailure = broadcastKeeperFailure;
  next();
});

app.use((_req: any, res: any) => {
  res.status(404).json({ success: false, error: "Not found" });
});

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.status === 429) {
    res.status(429).json({ success: false, error: "Too many requests" });
    return;
  }
  logger.error(err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

export { app, logger };
