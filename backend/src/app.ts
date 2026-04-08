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

app.use("/api/markets", marketsRouter);
app.use("/api/user", userRouter);
app.use("/api/stats", statsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/insurance", insuranceRouter);
app.use("/api/sync", syncRouter);

app.use((_req, res) => {
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
