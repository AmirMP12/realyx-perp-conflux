import { ethers } from "ethers";
import { recordRpcResult, setRpcCircuitState } from "../middleware/metrics.js";

/**
 * RPC provider pool with health-checked failover and per-endpoint circuit
 * breaking.
 *
 * Each endpoint has a circuit breaker with three states:
 *   - CLOSED:    healthy, freely routed to.
 *   - OPEN:      tripped after `FAILURE_THRESHOLD` consecutive failures; skipped
 *                for `COOLDOWN_MS` so a degraded provider can't keep poisoning
 *                reads. While open it is only used as a last resort if every
 *                endpoint is open.
 *   - HALF_OPEN: after the cooldown, a single trial request is allowed; success
 *                closes the circuit, failure re-opens it with a longer cooldown.
 *
 * Routing always prefers CLOSED endpoints (fewest failures first), then
 * HALF_OPEN (one trial), then OPEN (last resort). Outcomes and circuit-state
 * transitions are exported to Prometheus so failover is observable.
 */

const DEFAULT_TESTNET_RPCS = [
    "https://evmtestnet.confluxrpc.com",
    "https://evmtestnet.confluxrpc.org",
];
const DEFAULT_MAINNET_RPCS = ["https://evm.confluxrpc.com"];

/** Consecutive failures before the circuit trips OPEN. */
const FAILURE_THRESHOLD = Math.max(1, Number(process.env.RPC_FAILURE_THRESHOLD ?? "3"));
/** Base cooldown before a tripped endpoint gets a half-open trial. */
const COOLDOWN_MS = Math.max(1_000, Number(process.env.RPC_COOLDOWN_MS ?? "30000"));
/** Cap on the exponential cooldown growth for a repeatedly-failing endpoint. */
const MAX_COOLDOWN_MS = Math.max(COOLDOWN_MS, Number(process.env.RPC_MAX_COOLDOWN_MS ?? "300000"));

type CircuitState = "closed" | "open" | "half-open";

interface Endpoint {
    url: string;
    /** Host only, for low-cardinality metric labels (no API keys). */
    host: string;
    provider: ethers.JsonRpcProvider;
    /** Consecutive failure count; drives the breaker and ordering. */
    failures: number;
    /** Epoch ms until which an OPEN endpoint is skipped. */
    openUntil: number;
    /** Number of times the breaker has opened (drives cooldown backoff). */
    trips: number;
    state: CircuitState;
}

export function getRpcUrls(): string[] {
    const urls: string[] = [];
    const push = (u: string) => {
        const t = u.trim();
        if (t && !urls.includes(t)) urls.push(t);
    };

    const list = (process.env.RPC_URLS ?? "").trim();
    if (list) list.split(",").forEach(push);
    push(process.env.RPC_URL ?? "");
    push(process.env.RPC_FALLBACK_URL ?? "");

    const chainId = process.env.CHAIN_ID ?? "71";
    const defaults = chainId === "1030" ? DEFAULT_MAINNET_RPCS : DEFAULT_TESTNET_RPCS;
    defaults.forEach(push);

    return urls;
}

function chainId(): number {
    return parseInt(process.env.CHAIN_ID ?? "71", 10);
}

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return "invalid";
    }
}

let endpoints: Endpoint[] | null = null;
let builtFromKey = "";

function poolKey(): string {
    return `${getRpcUrls().join("|")}@${chainId()}`;
}

function ensurePool(): Endpoint[] {
    const key = poolKey();
    if (endpoints && builtFromKey === key) return endpoints;
    const id = chainId();
    endpoints = getRpcUrls().map((url) => ({
        url,
        host: hostOf(url),
        provider: new ethers.JsonRpcProvider(url, id),
        failures: 0,
        openUntil: 0,
        trips: 0,
        state: "closed" as CircuitState,
    }));
    builtFromKey = key;
    return endpoints;
}

/**
 * Refresh an endpoint's circuit state given the current time. An OPEN endpoint
 * whose cooldown has elapsed transitions to HALF_OPEN (eligible for one trial).
 */
function refreshState(ep: Endpoint, now: number): void {
    if (ep.state === "open" && now >= ep.openUntil) {
        ep.state = "half-open";
        setRpcCircuitState(ep.host, "half-open");
    }
}

/** Rank for ordering: closed (0) < half-open (1) < open (2). */
function stateRank(state: CircuitState): number {
    return state === "closed" ? 0 : state === "half-open" ? 1 : 2;
}

/**
 * Endpoints ordered for routing: closed first (fewest failures), then half-open
 * (one trial allowed), then open (last resort if everything is tripped).
 */
function orderedEndpoints(): Endpoint[] {
    const now = Date.now();
    const pool = ensurePool();
    pool.forEach((ep) => refreshState(ep, now));
    return [...pool].sort((a, b) => {
        const r = stateRank(a.state) - stateRank(b.state);
        if (r !== 0) return r;
        return a.failures - b.failures;
    });
}

function markSuccess(ep: Endpoint): void {
    const wasNotClosed = ep.state !== "closed";
    ep.failures = 0;
    ep.openUntil = 0;
    ep.trips = 0;
    ep.state = "closed";
    if (wasNotClosed) setRpcCircuitState(ep.host, "closed");
}

function markFailure(ep: Endpoint): void {
    ep.failures += 1;
    // A failed trial in half-open, or crossing the threshold in closed, opens it.
    if (ep.state === "half-open" || ep.failures >= FAILURE_THRESHOLD) {
        ep.trips += 1;
        // Exponential backoff capped at MAX_COOLDOWN_MS.
        const backoff = Math.min(MAX_COOLDOWN_MS, COOLDOWN_MS * 2 ** Math.max(0, ep.trips - 1));
        ep.openUntil = Date.now() + backoff;
        ep.state = "open";
        setRpcCircuitState(ep.host, "open");
    }
}

/**
 * Run `fn` against the healthiest provider, failing over through the rest of the
 * pool on error. Records per-endpoint outcome + latency metrics and drives each
 * endpoint's circuit breaker. Throws the last error only if every endpoint
 * fails.
 */
export async function withProvider<T>(fn: (provider: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
    const ordered = orderedEndpoints();
    if (ordered.length === 0) throw new Error("No RPC endpoints configured");

    let lastErr: unknown;
    for (const ep of ordered) {
        const start = Date.now();
        try {
            const result = await fn(ep.provider);
            recordRpcResult(ep.host, "success", Date.now() - start);
            markSuccess(ep);
            return result;
        } catch (e) {
            recordRpcResult(ep.host, "failure", Date.now() - start);
            markFailure(ep);
            lastErr = e;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Healthiest provider for callers that construct their own contracts. */
export function getProvider(): ethers.JsonRpcProvider {
    const ordered = orderedEndpoints();
    if (ordered.length === 0) throw new Error("No RPC endpoints configured");
    return ordered[0].provider;
}

/**
 * Diagnostics for /health and tests. Reports the configured endpoints and their
 * recorded health WITHOUT forcing provider construction or any network calls.
 * `cooling` is retained for backward compatibility (true when the breaker is
 * OPEN); `state` exposes the full circuit state.
 */
export function getPoolHealth(): { url: string; failures: number; cooling: boolean; state: CircuitState }[] {
    const now = Date.now();
    if (endpoints && builtFromKey === poolKey()) {
        return endpoints.map((e) => {
            refreshState(e, now);
            return {
                url: e.url,
                failures: e.failures,
                cooling: e.state === "open",
                state: e.state,
            };
        });
    }
    return getRpcUrls().map((url) => ({ url, failures: 0, cooling: false, state: "closed" as CircuitState }));
}

/** Force a rebuild (tests / config changes). */
export function __resetRpcPool(): void {
    endpoints = null;
    builtFromKey = "";
}
