import pino from "pino";

/**
 * Single shared structured logger for the whole backend.
 *
 * Services used to log via raw `console.*`, which bypassed log levels and
 * structured fields and produced unstructured noise. Everything now imports
 * this one pino instance so logs are level-filtered, JSON-structured, and
 * silenced under tests.
 *
 * NOTE: this module intentionally reads `process.env` directly and does NOT
 * import `./config.js`. `config.ts` runs `dotenv.config()` as an import-time
 * side effect, and pulling that into every service would repopulate env vars
 * (e.g. POSTGRES_URL) in unit tests that deliberately unset them. Keeping the
 * logger dependency-free avoids that coupling.
 *
 * Level policy:
 *   - test:        silent  (keeps jest output clean; spies still record calls)
 *   - development: debug
 *   - otherwise:   info    (override with LOG_LEVEL when needed)
 */
function resolveLevel(): string {
  const explicit = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (explicit) return explicit;
  const env = process.env.NODE_ENV ?? "development";
  if (env === "test") return "silent";
  if (env === "development") return "debug";
  return "info";
}

export const logger = pino({ level: resolveLevel() });

export type Logger = typeof logger;
