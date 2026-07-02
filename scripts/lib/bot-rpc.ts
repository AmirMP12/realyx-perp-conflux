/**
 * Shared RPC resilience for keeper bots: error parsing, global cooldown on
 * daily quota / rate limits, and a factory for per-call retry with failover.
 */

const DEFAULT_LONG_BACKOFF_THRESHOLD_MS = 90_000;

const CONFLUX_FALLBACKS: Record<string, string> = {};

/** Serialize an error (including nested JSON-RPC payloads) for pattern matching. */
export function errorText(err: unknown): string {
    if (err instanceof Error) {
        const code = (err as { code?: unknown }).code;
        const nested = (err as { error?: unknown; info?: unknown }).error ?? (err as { info?: unknown }).info;
        const nestedText =
            nested != null ? ` ${JSON.stringify(nested, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}` : "";
        return `${err.message} ${code ?? ""}${nestedText}`;
    }
    try {
        return JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    } catch {
        return String(err);
    }
}

export function isRetriableRpcError(err: unknown): boolean {
    const text = errorText(err);
    return /timeout|rate exceeded|too many requests|429|ETIMEDOUT|ECONNRESET|ENOTFOUND|SERVER_ERROR|daily request count exceeded|-32005|wrong epoch numbers|largest epoch number|-32016|could not coalesce error/i.test(
        text,
    );
}

export function retryAfterMsFromError(err: unknown, capMs = 7_200_000): number | null {
    const m = errorText(err).match(/try again after\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?(?:(\d+)ms)?/i);
    if (!m) return null;
    const hours = m[1] ? Number(m[1]) : 0;
    const minutes = m[2] ? Number(m[2]) : 0;
    const seconds = m[3] ? Number(m[3]) : 0;
    const millis = m[4] ? Number(m[4]) : 0;
    const total = hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + millis;
    if (!Number.isFinite(total) || total <= 0) return null;
    return Math.min(total, capMs);
}

/** Add Conflux .org mirror when the primary is a known .com public endpoint. */
export function confluxMirrorRpcUrl(primary: string): string | null {
    const normalized = primary.trim().replace(/\/+$/, "");
    return CONFLUX_FALLBACKS[normalized] ?? null;
}

/** Parse CSV env override or primary + optional Conflux mirror. */
export function parseBotRpcUrls(primary: string, csvEnv?: string): string[] {
    const csv = csvEnv?.trim();
    const seeds = csv ? csv.split(",") : [primary];
    const list: string[] = [];
    for (const raw of seeds) {
        const url = raw.trim();
        if (!url) continue;
        list.push(url);
        const mirror = confluxMirrorRpcUrl(url);
        if (mirror) list.push(mirror);
    }
    return [...new Set(list)];
}

export function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        if (typeof (t as NodeJS.Timeout).unref === "function") t.unref();
    });
}

/** Process-wide pause so every RPC call stops hammering after a quota hit. */
export class RpcPause {
    private untilMs = 0;

    isActive(): boolean {
        return Date.now() < this.untilMs;
    }

    remainingMs(): number {
        return Math.max(0, this.untilMs - Date.now());
    }

    /** Extend the pause window; returns the delay applied from now. */
    extendFor(err: unknown, fallbackMs: number): number {
        const hint = retryAfterMsFromError(err);
        const delay = hint ?? fallbackMs;
        this.untilMs = Math.max(this.untilMs, Date.now() + delay);
        return delay;
    }

    async waitIfActive(logPrefix: string): Promise<void> {
        const remaining = this.remainingMs();
        if (remaining <= 0) return;
        console.warn(`[${logPrefix}] global rpc cooldown; sleeping ${Math.round(remaining / 1000)}s`);
        await sleepMs(remaining);
    }
}

export interface CreateRpcRetryOptions {
    logPrefix: string;
    maxAttempts: number;
    baseDelayMs: number;
    longBackoffThresholdMs?: number;
    rpcPause: RpcPause;
    rotateRpc: (reason: string) => void | Promise<void>;
}

export function createRpcRetry(opts: CreateRpcRetryOptions) {
    const threshold = opts.longBackoffThresholdMs ?? DEFAULT_LONG_BACKOFF_THRESHOLD_MS;
    return async function withRpcRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
        let lastErr: unknown;
        for (let i = 1; i <= opts.maxAttempts; i++) {
            await opts.rpcPause.waitIfActive(opts.logPrefix);
            try {
                return await fn();
            } catch (err) {
                lastErr = err;
                if (!isRetriableRpcError(err)) throw err;
                const retryAfter = retryAfterMsFromError(err);
                opts.rpcPause.extendFor(err, opts.baseDelayMs * i);
                if (retryAfter != null && retryAfter > threshold) {
                    console.warn(
                        `[${opts.logPrefix}] ${op} rate-limited; provider hint=${retryAfter}ms exceeds threshold — propagating to main loop`,
                    );
                    throw err;
                }
                await opts.rotateRpc(`${op} retriable rpc error`);
                const delay = retryAfter ?? opts.baseDelayMs * i;
                if (retryAfter != null) {
                    console.warn(`[${opts.logPrefix}] ${op} rate-limited; backing off ${delay}ms (provider hint)`);
                }
                await sleepMs(delay);
            }
        }
        throw lastErr;
    };
}

/**
 * Back off the main loop on retriable RPC errors. Returns true when the caller
 * should `continue` the loop (sleep already applied).
 */
export async function backoffMainLoop(
    rpcPause: RpcPause,
    err: unknown,
    logPrefix: string,
    rpcRetryBaseDelayMs: number,
    context = "loop",
): Promise<boolean> {
    if (!isRetriableRpcError(err)) return false;
    const delay = rpcPause.extendFor(err, Math.min(300_000, rpcRetryBaseDelayMs * 10));
    console.warn(`[${logPrefix}] ${context} rate-limited; sleeping ${Math.round(delay / 1000)}s before next attempt`);
    await sleepMs(delay);
    return true;
}
