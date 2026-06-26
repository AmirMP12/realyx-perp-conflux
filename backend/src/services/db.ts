import pg from "pg";

/**
 * Database access with optional read-replica routing.
 *
 * Writes (the indexer ingest path) always go to the primary (`POSTGRES_URL`).
 * Read-heavy API queries (markets, stats, leaderboard, history) are routed to a
 * read replica when `POSTGRES_READ_URL` is configured, offloading the primary
 * for leader-grade read throughput. When no replica is set, reads transparently
 * fall back to the primary so behavior is unchanged in single-DB deployments.
 */

const { Pool } = pg;

/**
 * Connection-pool sizing.
 *
 * Serverless runtimes want a tiny pool — each invocation is short-lived and a
 * large pool just exhausts Postgres connection slots across many cold starts,
 * so the default stays at 1. A long-running container (the indexer worker or a
 * standalone API tier) benefits from real concurrency, so set `PG_POOL_MAX`
 * (e.g. 10–20) there. Bounded to a sane range so a typo can't open hundreds of
 * connections.
 */
function poolMax(): number {
    const raw = Number(process.env.PG_POOL_MAX ?? "1");
    if (!Number.isFinite(raw) || raw < 1) return 1;
    return Math.min(100, Math.floor(raw));
}

const POOL_OPTS: pg.PoolConfig = {
    // Serverless-safe defaults: fail fast instead of hanging and timing out.
    max: poolMax(),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    allowExitOnIdle: true,
};

let writePool: pg.Pool | null = null;
let readPool: pg.Pool | null = null;
let readPoolIsPrimary = false;

function ssl() {
    return process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined;
}

/** Primary (writer) pool. Returns null when no DB is configured. */
export function getWritePool(): pg.Pool | null {
    if (writePool) return writePool;
    if (!process.env.POSTGRES_URL) return null;
    writePool = new Pool({ connectionString: process.env.POSTGRES_URL, ssl: ssl(), ...POOL_OPTS });
    return writePool;
}

/**
 * Reader pool. Uses POSTGRES_READ_URL when present, otherwise the primary.
 * Falls back to the primary if the replica pool can't be constructed.
 */
export function getReadPool(): pg.Pool | null {
    if (readPool) return readPool;
    const replicaUrl = (process.env.POSTGRES_READ_URL ?? "").trim();
    if (!replicaUrl) {
        readPoolIsPrimary = true;
        return getWritePool();
    }
    try {
        readPool = new Pool({ connectionString: replicaUrl, ssl: ssl(), ...POOL_OPTS });
        readPoolIsPrimary = false;
        return readPool;
    } catch {
        readPoolIsPrimary = true;
        return getWritePool();
    }
}

export function isUsingReadReplica(): boolean {
    return !readPoolIsPrimary && Boolean((process.env.POSTGRES_READ_URL ?? "").trim());
}

export function resetPools(): void {
    writePool = null;
    readPool = null;
    readPoolIsPrimary = false;
}
