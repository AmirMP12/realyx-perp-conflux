import pg from "pg";
import { logger } from "../logger.js";

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

/**
 * SSL config for Postgres connections.
 * Disabled when POSTGRES_SSL=false (e.g. Railway private network — already
 * encrypted at the network layer and doesn't support ALPN-based TLS).
 * Enabled with rejectUnauthorized=false for all other production connections
 * (public proxy URLs that require SSL but use self-signed certs).
 */
function ssl(): { rejectUnauthorized: boolean } | undefined {
    if (/^(0|false|no)$/i.test(process.env.POSTGRES_SSL ?? "")) return undefined;
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

/** When a replica is configured but empty while the primary has events, route reads to primary. */
let replicaStaleFallback = false;
let replicaStaleCheckedAt = 0;
const REPLICA_STALE_RECHECK_MS = 60_000;

/**
 * Pool for read-heavy API aggregates. Falls back to the primary when no replica
 * is configured, replica construction failed, or the replica appears empty
 * while the primary already has indexed events (common misconfiguration).
 */
export async function getEffectiveReadPool(): Promise<pg.Pool | null> {
    const read = getReadPool();
    const write = getWritePool();
    if (!read) return write;
    if (!write || !isUsingReadReplica()) return read;

    const now = Date.now();
    if (replicaStaleFallback && now - replicaStaleCheckedAt < REPLICA_STALE_RECHECK_MS) {
        return write;
    }
    if (now - replicaStaleCheckedAt < REPLICA_STALE_RECHECK_MS && !replicaStaleFallback) {
        return read;
    }

    replicaStaleCheckedAt = now;
    try {
        const [readCount, writeCount] = await Promise.all([
            read.query("SELECT COUNT(*)::int AS n FROM position_events"),
            write.query("SELECT COUNT(*)::int AS n FROM position_events"),
        ]);
        const rN = Number(readCount.rows[0]?.n ?? 0);
        const wN = Number(writeCount.rows[0]?.n ?? 0);
        if (wN > 0 && rN === 0) {
            if (!replicaStaleFallback) {
                logger.warn(
                    { primaryEvents: wN, replicaEvents: rN },
                    "[db] read replica is empty but primary has indexed events — falling back to primary for reads",
                );
            }
            replicaStaleFallback = true;
            return write;
        }
        replicaStaleFallback = false;
        return read;
    } catch (e) {
        logger.warn(
            { err: e instanceof Error ? e.message : e },
            "[db] replica health check failed — using read pool",
        );
        return read;
    }
}

export function resetPools(): void {
    writePool = null;
    readPool = null;
    readPoolIsPrimary = false;
    replicaStaleFallback = false;
    replicaStaleCheckedAt = 0;
}
