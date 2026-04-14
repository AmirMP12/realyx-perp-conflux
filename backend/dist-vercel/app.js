"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const pino_1 = __importDefault(require("pino"));
const pino_http_1 = __importDefault(require("pino-http"));
const config_js_1 = require("./config.js");
const markets_js_1 = __importDefault(require("./routes/markets.js"));
const user_js_1 = __importDefault(require("./routes/user.js"));
const stats_js_1 = __importDefault(require("./routes/stats.js"));
const leaderboard_js_1 = __importDefault(require("./routes/leaderboard.js"));
const insurance_js_1 = __importDefault(require("./routes/insurance.js"));
const health_js_1 = __importDefault(require("./routes/health.js"));
const sync_js_1 = __importDefault(require("./routes/sync.js"));
const rateLimit_js_1 = require("./middleware/rateLimit.js");
const metrics_js_1 = require("./middleware/metrics.js");
const logger = (0, pino_1.default)({
    level: config_js_1.config.nodeEnv === "test"
        ? "silent"
        : config_js_1.config.nodeEnv === "development"
            ? "debug"
            : "info",
});
exports.logger = logger;
const httpLogger = pino_http_1.default({ logger });
const app = (0, express_1.default)();
exports.app = app;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json());
app.use(httpLogger);
app.use(metrics_js_1.metricsMiddleware);
app.use("/health", health_js_1.default);
app.use(rateLimit_js_1.apiRateLimit);
app.use("/api/markets", markets_js_1.default);
app.use("/api/user", user_js_1.default);
app.use("/api/stats", stats_js_1.default);
app.use("/api/leaderboard", leaderboard_js_1.default);
app.use("/api/insurance", insurance_js_1.default);
app.use("/api/sync", sync_js_1.default);
app.use((_req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
});
app.use((err, _req, res, _next) => {
    if (err.status === 429) {
        res.status(429).json({ success: false, error: "Too many requests" });
        return;
    }
    logger.error(err);
    res.status(500).json({ success: false, error: "Internal server error" });
});
