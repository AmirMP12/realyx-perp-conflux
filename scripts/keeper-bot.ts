import "dotenv/config";
import { ethers } from "ethers";
import { loadDeployment } from "./write-deployment";

/**
 * Realyx order-execution keeper.
 *
 * Watches `OrderCreated`, refreshes the on-chain Pyth price for the order's
 * market, and calls `executeOrder`. Hardened for production liveness:
 *   - Multi-RPC failover (`withRpcRetry`/`rotateRpc`).
 *   - NonceManager-backed signer so orders can execute concurrently without
 *     nonce collisions (a bounded pool of `KEEPER_MAX_CONCURRENCY`), instead of
 *     one slow `tx.wait()` head-of-line-blocking the whole queue.
 *   - Every order is reported to the backend on terminal error OR after
 *     `KEEPER_MAX_ORDER_ATTEMPTS` exhausted retries / repeated reverts, so an
 *     order never sits pending forever with the trader getting no feedback.
 *
 * KNOWN RESIDUAL (keeper price-selection / MEV): the keeper still
 * chooses *which* valid Hermes update to push and *when* to execute, so within
 * the oracle staleness window it has bounded latitude to pick a favorable price.
 * This cannot be fully closed off-chain — it requires a contract-side change to
 * bind the executed price to the order's submission time (e.g. require the Pyth
 * `publishTime` to be >= the order's createdAt and within a tight max-age, and
 * require the update to target the order's own feed id). Tracked as a follow-up
 * to `OracleAggregator.updatePrices` / `TradingLib.applyPythUpdateAndRefund`.
 */

type PendingOrder = {
    id: bigint;
    createdAtBlock: bigint;
    market: string;
    account: string;
    /** Execution attempts so far; drives give-up + failure reporting. */
    attempts: number;
};

const ORDER_CREATED_EVENT =
    "event OrderCreated(uint256 indexed orderId, address indexed account, uint8 orderType, address market)";
const ORDER_EXECUTED_EVENT = "event OrderExecuted(uint256 indexed orderId, uint256 positionId, address indexed keeper)";
const ORDER_CANCELLED_EVENT = "event OrderCancelled(uint256 indexed orderId, string reason)";

const EXECUTE_ORDER_ABI = [
    "function executeOrder(uint256 orderId, bytes[] calldata updateData) external payable",
    "function hasRole(bytes32 role, address account) external view returns (bool)",
    "function oracleAggregator() external view returns (address)",
];
const ORACLE_AGGREGATOR_ABI = [
    "function pyth() external view returns (address)",
    "function getOracleConfig(address collection) external view returns (bytes32, uint256, uint256, uint256)",
];
const PYTH_ABI = [
    "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
    "function updatePriceFeeds(bytes[] calldata updateData) external payable",
];
const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const STALE_PRICE_SELECTOR = "0x19abf40e";

// Transient on-chain conditions that can clear on their own: oracle confidence
// narrowing, the TWAP warming up / next-slice interval not yet elapsed, the
// spot↔TWAP deviation settling, or an RWA market simply being outside its
// trading session. These are NOT execution failures — a resting/limit order
// should stay pending and be retried on later ticks rather than being given up
// and reported to the trader as failed. Verified selectors (keccak of the
// error signature, first 4 bytes):
const TRANSIENT_SELECTORS = new Set<string>([
    "0x40eba60f", // InsufficientConfidence()
    "0xe0819ac8", // OpenPriceDeviation()
    "0x7c702f5a", // TwapNotReady()
    "0x14f3f55f", // TWAPIntervalNotMet()
    "0x4657f05f", // InsufficientTWAPData()
    "0xd41b1bb1", // NoValidPrice()
    "0xc3f4b6e3", // ClosePriceDeviation()
    "0x4183f5e7", // WithdrawPriceDeviation()
    "0xdea3b44d", // MarketHoursClosed()
    "0x0b5f6bf0", // MarketClosed()
]);

function getEnv(name: string, fallback?: string): string {
    const value = process.env[name] ?? fallback;
    if (!value) throw new Error(`${name} is required`);
    return value;
}

/**
 * Public RPC defaults per network, mirroring hardhat.config.ts. Used as a last
 * resort so the keeper stays live even when KEEPER_RPC_URL / CONFLUX_*_RPC_URL
 * are not provided by the deployment environment (e.g. a fresh Railway service).
 */
const DEFAULT_RPC_URLS: Record<string, string> = {
    confluxTestnet: "https://evmtestnet.confluxrpc.com",
    confluxESpace: "https://evm.confluxrpc.com",
    conflux: "https://evm.confluxrpc.com",
    confluxMainnet: "https://evm.confluxrpc.com",
};

function defaultRpcUrlForNetwork(network: string): string | undefined {
    return DEFAULT_RPC_URLS[network];
}

function toMsFromSeconds(raw: string | undefined, fallbackSeconds: number): number {
    const n = Number(raw ?? fallbackSeconds);
    if (!Number.isFinite(n) || n <= 0) return fallbackSeconds * 1000;
    return Math.floor(n * 1000);
}

function selectorFromError(err: unknown): string | null {
    const serialized = JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const match = serialized.match(/0x[a-fA-F0-9]{8,}/);
    if (!match) return null;
    return match[0].slice(0, 10).toLowerCase();
}

function errorText(err: unknown): string {
    if (err instanceof Error) return `${err.message} ${(err as any).code ?? ""}`;
    // ethers nests the JSON-RPC body under `error`/`info`; stringify to catch it.
    return JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function isRetriableRpcError(err: unknown): boolean {
    const text = errorText(err);
    // Generic transient transport errors, provider rate limiting (incl. the
    // Conflux public RPC's `-32005` "daily request count exceeded"), and Conflux
    // eSpace epoch-lag filter errors (`-32016`). The latter fire when a
    // load-balanced peer serves a `getBlockNumber` ahead of the log-index node;
    // they clear once the node catches up, so a short backoff + retry is correct.
    return /timeout|rate exceeded|too many requests|429|ETIMEDOUT|SERVER_ERROR|daily request count exceeded|-32005|wrong epoch numbers|largest epoch number|-32016/i.test(
        text,
    );
}

/**
 * Parse the "try again after 7m53.649s" / "5.528s" / "55ms" hint the Conflux
 * public RPC returns with `-32005`, so we back off for (close to) the real
 * cooldown instead of tight-looping and burning the next day's quota. Capped so
 * a multi-minute cooldown doesn't wedge the process indefinitely.
 */
function retryAfterMsFromError(err: unknown, capMs = 60_000): number | null {
    const m = errorText(err).match(/try again after\s+(?:(\d+)m)?(?:([\d.]+)s)?(?:(\d+)ms)?/i);
    if (!m) return null;
    const minutes = m[1] ? Number(m[1]) : 0;
    const seconds = m[2] ? Number(m[2]) : 0;
    const millis = m[3] ? Number(m[3]) : 0;
    const total = minutes * 60_000 + seconds * 1_000 + millis;
    if (!Number.isFinite(total) || total <= 0) return null;
    return Math.min(total, capMs);
}

function parseRpcUrls(primary: string): string[] {
    const csv = process.env.KEEPER_RPC_URLS;
    const list = (csv ? csv.split(",") : [primary]).map((s) => s.trim()).filter(Boolean);
    return [...new Set(list)];
}

function isTerminalExecuteError(err: unknown): boolean {
    const selector = selectorFromError(err);
    if (!selector) return false;

    // Order no longer exists on-chain.
    const terminalSelectors = new Set([
        "0xd36d8965", // OrderNotFound()
        "0x08c379a0", // Error(string)
        "0x9165f13e", // InsufficientMargin
        "0xfb8eb1b3", // MaxLeverageExceeded
        "0xa0caf76c", // PositionSizeTooSmall
        "0xe372871f", // SlippageExceeded
        "0xbea3c635", // MarketNotActive
        "0xab63ac46", // MaxPositionSizeExceeded
        "0x19abf40e", // StalePrice – terminal after retry
    ]);
    return terminalSelectors.has(selector);
}

/**
 * POST a keeper failure to the backend API so it can be persisted and pushed via WebSocket.
 */
async function reportKeeperFailure(
    apiBaseUrl: string,
    orderId: bigint,
    traderAddress: string,
    marketAddress: string,
    failureReason: string,
    selector: string,
): Promise<void> {
    try {
        const url = `${apiBaseUrl.replace(/\/+$/, "")}/api/v1/keeper/failure`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        // The backend's /api/v1/keeper/failure route is bearer-authenticated and
        // fails closed in production. Send the shared secret when configured so
        // failure notifications actually persist + broadcast to the trader.
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const webhookSecret = (process.env.KEEPER_WEBHOOK_SECRET ?? "").trim();
        if (webhookSecret) headers.Authorization = `Bearer ${webhookSecret}`;
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                orderId: orderId.toString(),
                traderAddress,
                marketAddress,
                failureReason,
                selector,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
            console.warn(`[keeper] reportKeeperFailure HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (err) {
        // Don't let webhook failures crash the keeper loop
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[keeper] reportKeeperFailure network error: ${msg}`);
    }
}

function bytes32ToPythId(feedId: string): string {
    return feedId.toLowerCase().replace(/^0x/, "");
}

async function main() {
    const network = process.env.KEEPER_NETWORK || process.env.HARDHAT_NETWORK || "confluxTestnet";
    const deployment = loadDeployment(network);

    const rpcUrl = getEnv(
        "KEEPER_RPC_URL",
        process.env.CONFLUX_TESTNET_RPC_URL || process.env.CONFLUX_RPC_URL || defaultRpcUrlForNetwork(network),
    );
    const privateKey = getEnv("KEEPER_PRIVATE_KEY", process.env.PRIVATE_KEY);
    const tradingCoreAddress =
        process.env.KEEPER_TRADING_CORE_ADDRESS ||
        process.env.DEPLOYED_TRADING_CORE ||
        deployment?.contracts?.tradingCore;

    if (!tradingCoreAddress) {
        throw new Error("Set KEEPER_TRADING_CORE_ADDRESS or DEPLOYED_TRADING_CORE (or deployment/<network>.json)");
    }

    const pollMs = toMsFromSeconds(process.env.KEEPER_POLL_INTERVAL_SECONDS, 3);
    const minPriceRefreshMs = toMsFromSeconds(process.env.KEEPER_MIN_PRICE_REFRESH_SECONDS, 20);
    const keeperApiBaseUrl = process.env.KEEPER_API_BASE_URL || "http://localhost:3001";
    const lookbackBlocks = BigInt(Math.max(1, Number(process.env.KEEPER_LOOKBACK_BLOCKS ?? "5000")));
    const blockChunkSize = BigInt(Math.max(100, Number(process.env.KEEPER_BLOCK_CHUNK_SIZE ?? "500")));
    // Confirmation lag: never query logs right up to the head. On Conflux eSpace
    // a load-balanced peer can report a `getBlockNumber` that the log-index node
    // hasn't reached yet, which makes `eth_getLogs` reject the range with
    // `-32016` ("wrong epoch numbers" / "expected a number less than largest
    // epoch"). Staying a few blocks behind the head avoids that entirely.
    const confirmations = BigInt(Math.max(0, Number(process.env.KEEPER_CONFIRMATIONS ?? "30")));
    const hermesBase = (process.env.KEEPER_HERMES_URL || "https://hermes.pyth.network").replace(/\/+$/, "");
    const rpcRetryBaseDelayMs = Math.max(100, Number(process.env.KEEPER_RPC_RETRY_BASE_DELAY_MS ?? "300"));
    // How many orders to execute in parallel per tick. Serial `await tx.wait()`
    // meant one slow confirmation blocked every queued order behind it; a bounded
    // pool keeps throughput up without unbounded nonce/gas pressure.
    const maxConcurrency = Math.max(1, Number(process.env.KEEPER_MAX_CONCURRENCY ?? "4"));
    // After this many failed execution attempts (non-terminal reverts, dropped
    // tx receipts, stale-price retries that never land) we report the failure to
    // the backend and stop retrying, so an order never sits pending forever with
    // the trader getting no notification.
    const maxOrderAttempts = Math.max(1, Number(process.env.KEEPER_MAX_ORDER_ATTEMPTS ?? "5"));

    const rpcUrls = parseRpcUrls(rpcUrl);
    let rpcIndex = 0;
    let provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
    // NonceManager hands out sequential nonces locally so several in-flight txs
    // (parallel executeOrder + Pyth refresh) don't collide on the same nonce,
    // which would otherwise cause "nonce too low"/replacement errors under
    // concurrency. The raw wallet is kept for signing-only needs.
    let baseWallet = new ethers.Wallet(privateKey, provider);
    let wallet: ethers.Signer = new ethers.NonceManager(baseWallet);
    const iface = new ethers.Interface([ORDER_CREATED_EVENT, ORDER_EXECUTED_EVENT, ORDER_CANCELLED_EVENT]);
    let tradingCore = new ethers.Contract(tradingCoreAddress, EXECUTE_ORDER_ABI, wallet);

    const createdTopic = iface.getEvent("OrderCreated").topicHash;
    const executedTopic = iface.getEvent("OrderExecuted").topicHash;
    const cancelledTopic = iface.getEvent("OrderCancelled").topicHash;

    // Pyth contract handle — rebuilt alongside the wallet on RPC rotation.
    let pyth: ethers.Contract;
    let oracleAggregator: ethers.Contract;

    async function rotateRpc(reason: string) {
        if (rpcUrls.length <= 1) return;
        rpcIndex = (rpcIndex + 1) % rpcUrls.length;
        provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
        baseWallet = new ethers.Wallet(privateKey, provider);
        wallet = new ethers.NonceManager(baseWallet);
        tradingCore = new ethers.Contract(tradingCoreAddress, EXECUTE_ORDER_ABI, wallet);
        // Rebind the oracle/pyth handles to the new signer if they exist yet.
        if (oracleAggregator) oracleAggregator = oracleAggregator.connect(wallet) as ethers.Contract;
        if (pyth) pyth = pyth.connect(wallet) as ethers.Contract;
        console.warn(`[keeper] switched rpc -> ${rpcUrls[rpcIndex]} (reason: ${reason})`);
    }

    async function withRpcRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
        const maxAttempts = Math.max(1, Number(process.env.KEEPER_RPC_MAX_ATTEMPTS ?? "3"));
        let lastErr: unknown;
        for (let i = 1; i <= maxAttempts; i++) {
            try {
                return await fn();
            } catch (err) {
                lastErr = err;
                if (!isRetriableRpcError(err)) throw err;
                await rotateRpc(`${op} retriable rpc error`);
                // Honor the provider's explicit cooldown hint (Conflux `-32005`
                // "try again after Xs") when present; otherwise exponential-ish
                // backoff. This stops the tight retry loop that was exhausting
                // the daily request quota.
                const retryAfter = retryAfterMsFromError(err);
                const delay = retryAfter ?? rpcRetryBaseDelayMs * i;
                if (retryAfter != null) {
                    console.warn(`[keeper] ${op} rate-limited; backing off ${delay}ms (provider hint)`);
                }
                await new Promise((r) => setTimeout(r, delay));
            }
        }
        throw lastErr;
    }

    const marketFeedCache = new Map<string, string>();
    const lastRefreshByMarket = new Map<string, number>();

    process.on("SIGTERM", () => {
        console.log("[keeper] Received SIGTERM. Web is shutting down the container gracefully...");
        process.exit(0);
    });

    process.on("SIGINT", () => {
        console.log("[keeper] Received SIGINT. Shutting down...");
        process.exit(0);
    });

    console.log("[keeper] starting");

    console.log("[keeper] fetching network info...");
    const networkInfo = await withRpcRetry(() => provider.getNetwork(), "getNetwork");
    console.log(`[keeper] network info fetched: chainId=${networkInfo.chainId}`);

    console.log("[keeper] fetching latest block number...");
    const latest = await withRpcRetry(() => provider.getBlockNumber(), "getBlockNumber");
    console.log(`[keeper] latest block: ${latest}`);

    let cursor = BigInt(Math.max(0, latest - Number(lookbackBlocks)));
    // Resolve the backfill start block so resting orders created BEFORE the
    // keeper started are still discovered (the contract exposes no pending-order
    // enumeration, so log backfill is the only source of truth). Precedence:
    //   1. KEEPER_START_BLOCK env (explicit operator override)
    //   2. `deploymentBlock` recorded in deployment/<network>.json (auto)
    //   3. latest - lookbackBlocks (last-resort window)
    // A full replay from the deployment block reconciles Created vs
    // Executed/Cancelled, leaving `pending` with exactly the still-open orders.
    let startSource = "lookback";
    const startBlockEnv = process.env.KEEPER_START_BLOCK?.trim();
    const deploymentBlock = deployment?.deploymentBlock;
    if (startBlockEnv && /^\d+$/.test(startBlockEnv)) {
        cursor = BigInt(startBlockEnv);
        startSource = "KEEPER_START_BLOCK";
    } else if (deploymentBlock != null && /^\d+$/.test(String(deploymentBlock))) {
        cursor = BigInt(String(deploymentBlock));
        startSource = "deploymentBlock";
    }
    console.log(`[keeper] backfill start=${cursor.toString()} source=${startSource} (replaying to discover resting orders)`);
    const pending = new Map<string, PendingOrder>();
    // Orders currently being executed this tick, so the bounded pool never
    // double-submits the same order (which would burn gas and trip nonce races).
    const inFlight = new Set<string>();
    // Heartbeat throttle so an idle keeper still logs liveness periodically.
    const heartbeatMs = toMsFromSeconds(process.env.KEEPER_HEARTBEAT_SECONDS, 30);
    let lastHeartbeat = 0;

    console.log(`[keeper] chainId=${networkInfo.chainId.toString()} rpc=${rpcUrls[rpcIndex]}`);
    console.log(`[keeper] wallet=${baseWallet.address}`);
    console.log(`[keeper] tradingCore=${tradingCoreAddress}`);
    console.log(`[keeper] startBlock=${cursor.toString()} pollMs=${pollMs}`);

    console.log("[keeper] checking KEEPER_ROLE...");

    const hasKeeperRole = await withRpcRetry(
        () => tradingCore.hasRole(KEEPER_ROLE, baseWallet.address),
        "tradingCore.hasRole",
    );
    if (!hasKeeperRole) {
        throw new Error(
            `Wallet ${baseWallet.address} is missing KEEPER_ROLE (${KEEPER_ROLE}) on TradingCore ${tradingCoreAddress}.`,
        );
    }
    console.log("[keeper] KEEPER_ROLE verified.");

    console.log("[keeper] fetching OracleAggregator address...");
    const oracleAggregatorAddress = await withRpcRetry(
        () => tradingCore.oracleAggregator(),
        "tradingCore.oracleAggregator",
    );
    console.log(`[keeper] oracleAggregator=${oracleAggregatorAddress}`);
    oracleAggregator = new ethers.Contract(oracleAggregatorAddress, ORACLE_AGGREGATOR_ABI, wallet);

    console.log("[keeper] fetching Pyth address...");
    const pythAddress = await withRpcRetry(() => oracleAggregator.pyth(), "oracleAggregator.pyth");
    console.log(`[keeper] pythAddress=${pythAddress}`);
    pyth = new ethers.Contract(pythAddress, PYTH_ABI, wallet);

    console.log("[keeper] initialization complete.");
    console.log("[keeper] entering main loop...");

    async function getFeedIdForMarket(market: string): Promise<string | null> {
        const key = market.toLowerCase();
        const cached = marketFeedCache.get(key);
        if (cached) return cached;
        const [feedId] = (await withRpcRetry(
            () => oracleAggregator.getOracleConfig(market),
            "oracleAggregator.getOracleConfig",
        )) as [string, bigint, bigint, bigint];
        if (!feedId || feedId.toLowerCase() === ZERO_BYTES32) return null;
        marketFeedCache.set(key, feedId);
        return feedId;
    }

    async function fetchHermesUpdateData(feedId: string): Promise<string[] | null> {
        const idNoPrefix = bytes32ToPythId(feedId);
        const url = `${hermesBase}/v2/updates/price/latest?encoding=hex&ids[]=${idNoPrefix}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Hermes ${res.status}: ${res.statusText}`);
        const body = (await res.json()) as { binary?: { data?: string[] } };
        const updates = (body.binary?.data || []).filter(Boolean).map((d) => (d.startsWith("0x") ? d : `0x${d}`));
        return updates.length > 0 ? updates : null;
    }

    async function refreshPythForMarket(market: string, force = false): Promise<boolean> {
        const key = market.toLowerCase();
        const now = Date.now();
        const last = lastRefreshByMarket.get(key) ?? 0;
        if (!force && now - last < minPriceRefreshMs) return false;

        const feedId = await getFeedIdForMarket(market);
        if (!feedId) return false;

        const updateData = await fetchHermesUpdateData(feedId);
        if (!updateData) return false;

        const updateFee = (await withRpcRetry(() => pyth.getUpdateFee(updateData), "pyth.getUpdateFee")) as bigint;
        const tx = await pyth.updatePriceFeeds(updateData, { value: updateFee });
        await tx.wait();
        lastRefreshByMarket.set(key, now);
        console.log(`[keeper] refreshed pyth market=${market} tx=${tx.hash}`);
        return true;
    }

    /**
     * Execute a single pending order end-to-end. Returns when the order is
     * resolved (executed, given up after max attempts, or a transient failure
     * leaves it pending for a later tick). Safe to run concurrently for distinct
     * orders thanks to the NonceManager-backed signer.
     */
    async function processOrder(order: PendingOrder): Promise<void> {
        const key = order.id.toString();
        order.attempts += 1;
        try {
            // Ensure on-chain Pyth cache is refreshed for this market before execution.
            await refreshPythForMarket(order.market);

            const tx = await tradingCore.executeOrder(order.id, []);
            console.log(`[keeper] execute sent order=${key} tx=${tx.hash}`);
            const receipt = await tx.wait();
            if (receipt?.status === 1) {
                pending.delete(key);
                console.log(`[keeper] executed order=${key} block=${receipt.blockNumber}`);
                return;
            }
            console.warn(
                `[keeper] tx reverted order=${key} tx=${tx.hash} (attempt ${order.attempts}/${maxOrderAttempts})`,
            );
        } catch (err) {
            const selector = selectorFromError(err) ?? "n/a";
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
                `[keeper] execute failed order=${key} selector=${selector} attempt=${order.attempts}/${maxOrderAttempts} msg=${message}`,
            );

            // If stale price, force refresh and retry once immediately.
            if (selector === STALE_PRICE_SELECTOR) {
                try {
                    const refreshed = await refreshPythForMarket(order.market, true);
                    if (refreshed) {
                        const retryTx = await tradingCore.executeOrder(order.id, []);
                        console.log(`[keeper] retry execute sent order=${key} tx=${retryTx.hash}`);
                        const retryReceipt = await retryTx.wait();
                        if (retryReceipt?.status === 1) {
                            pending.delete(key);
                            console.log(`[keeper] executed on retry order=${key} block=${retryReceipt.blockNumber}`);
                            return;
                        }
                    }
                } catch (retryErr) {
                    const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                    console.warn(`[keeper] stale-price retry failed order=${key} msg=${retryMsg}`);
                }
            }

            // Transient oracle / market-session condition (confidence too wide,
            // TWAP not warmed up or slice interval not elapsed, spot↔TWAP
            // deviation, or market closed). The order is not failing — it's
            // simply not executable yet. Keep it pending and roll back the
            // attempt increment so these don't accumulate toward the give-up
            // limit; a later tick retries once the oracle/TWAP/market is ready.
            if (TRANSIENT_SELECTORS.has(selector)) {
                order.attempts -= 1;
                console.log(
                    `[keeper] order=${key} not yet executable (selector=${selector}); keeping pending for retry`,
                );
                return;
            }

            // Terminal on-chain error: stop immediately and notify the trader.
            if (isTerminalExecuteError(err)) {
                pending.delete(key);
                await reportKeeperFailure(keeperApiBaseUrl, order.id, order.account, order.market, message, selector);
                return;
            }

            // Non-terminal but out of attempts: give up and notify so the order
            // doesn't sit pending forever with the trader getting no feedback.
            if (order.attempts >= maxOrderAttempts) {
                pending.delete(key);
                await reportKeeperFailure(
                    keeperApiBaseUrl,
                    order.id,
                    order.account,
                    order.market,
                    `Max execution attempts (${maxOrderAttempts}) exhausted: ${message}`,
                    selector,
                );
            }
            return;
        }

        // Receipt came back unsuccessful (status !== 1) and wasn't an exception:
        // give up after max attempts and notify, otherwise leave for next tick.
        if (order.attempts >= maxOrderAttempts) {
            pending.delete(key);
            await reportKeeperFailure(
                keeperApiBaseUrl,
                order.id,
                order.account,
                order.market,
                `Max execution attempts (${maxOrderAttempts}) exhausted: tx reverted on-chain`,
                "n/a",
            );
        }
    }

    /** Run `tasks` with a bounded number of concurrent workers. */
    async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
        let idx = 0;
        const runNext = async (): Promise<void> => {
            while (idx < items.length) {
                const current = items[idx++];
                await worker(current);
            }
        };
        const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
        await Promise.all(workers);
    }

    while (true) {
        try {
            const head = BigInt(await withRpcRetry(() => provider.getBlockNumber(), "loop:getBlockNumber"));
            // Stay `confirmations` blocks behind the head so we never request an
            // epoch range the log-index node hasn't reached yet (-32016 guard).
            const safeHead = head > confirmations ? head - confirmations : 0n;
            let logsFoundThisTick = 0;
            if (safeHead > cursor) {
                let from = cursor + 1n;
                while (from <= safeHead) {
                    const to = from + blockChunkSize > safeHead ? safeHead : from + blockChunkSize;
                    if (to < from) break;

                    // One range scan with OR'd topics instead of three separate
                    // getLogs calls — cuts log-request volume (and daily-quota
                    // pressure) by ~3x. ethers accepts a nested array as an OR
                    // set for the first topic position.
                    const logs = await withRpcRetry(
                        () =>
                            provider.getLogs({
                                address: tradingCoreAddress,
                                fromBlock: from,
                                toBlock: to,
                                topics: [[createdTopic, executedTopic, cancelledTopic]],
                            }),
                        "getLogs",
                    );
                    logsFoundThisTick += logs.length;

                    for (const log of logs) {
                        const topic0 = log.topics[0];
                        const parsed = iface.parseLog(log);
                        const id = parsed?.args?.orderId as bigint | undefined;
                        if (id == null) continue;
                        if (topic0 === createdTopic) {
                            const market = (parsed?.args?.market as string | undefined) || ethers.ZeroAddress;
                            const account = (parsed?.args?.account as string | undefined) || ethers.ZeroAddress;
                            pending.set(id.toString(), {
                                id,
                                market,
                                account,
                                createdAtBlock: BigInt(log.blockNumber),
                                attempts: 0,
                            });
                            console.log(`[keeper] discovered order=${id.toString()} market=${market} block=${log.blockNumber}`);
                        } else {
                            // OrderExecuted / OrderCancelled — order is done.
                            pending.delete(id.toString());
                        }
                    }

                    // Advance the cursor per successful chunk so a mid-scan error
                    // doesn't force re-fetching ranges we already processed.
                    cursor = to;
                    from = to + 1n;
                }
            }

            // Throttled heartbeat so an idle keeper is visibly alive (and we can
            // tell "scanning, found nothing" apart from "stuck"). Logs at most
            // once per `heartbeatMs`, or immediately whenever logs were found.
            const nowMs = Date.now();
            if (logsFoundThisTick > 0 || nowMs - lastHeartbeat >= heartbeatMs) {
                lastHeartbeat = nowMs;
                console.log(
                    `[keeper] heartbeat head=${head.toString()} scannedTo=${cursor.toString()} pending=${pending.size} logsThisTick=${logsFoundThisTick}`,
                );
            }

            if (pending.size > 0) {
                // Only dispatch orders not already being processed; oldest first.
                const orders = [...pending.values()]
                    .filter((o) => !inFlight.has(o.id.toString()))
                    .sort((a, b) => (a.id < b.id ? -1 : 1));
                if (orders.length > 0) {
                    console.log(
                        `[keeper] pending=${pending.size} dispatching=${orders.length} concurrency=${maxConcurrency} newestBlock=${cursor.toString()}`,
                    );
                    await runPool(orders, maxConcurrency, async (order) => {
                        const key = order.id.toString();
                        inFlight.add(key);
                        try {
                            await processOrder(order);
                        } finally {
                            inFlight.delete(key);
                        }
                    });
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[keeper] loop error: ${message}`);
        }

        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}

main().catch((err) => {
    console.error("[keeper] fatal:", err);
    process.exit(1);
});
