import "dotenv/config";
import { ethers } from "ethers";
import {
    RpcPause,
    backoffMainLoop,
    createRpcRetry,
    errorText,
    parseBotRpcUrls,
    sleepMs,
} from "./lib/bot-rpc";
import { loadDeployment } from "./write-deployment";

type PendingOrder = {
    id: bigint;
    createdAtBlock: bigint;
    market: string;
    account: string;
    attempts: number;
    nextAttemptAt: number;
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
    const e = err as any;
    const candidates = [e?.data, e?.info?.error?.data, e?.error?.data, e?.revert?.selector];
    for (const c of candidates) {
        if (typeof c === "string" && /^0x[a-fA-F0-9]{8,}$/.test(c)) {
            return c.slice(0, 10).toLowerCase();
        }
    }
    const serialized = JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const matches = serialized.match(/0x[a-fA-F0-9]+/g) ?? [];
    for (const m of matches) {
        const hexLen = m.length - 2;
        if (hexLen === 40 || hexLen === 64) continue;
        if (hexLen >= 8) return m.slice(0, 10).toLowerCase();
    }
    return null;
}

const TRANSIENT_REASON_PATTERNS =
    /not ready|not yet|too early|market\s*(hours|closed)|closed|deviation|confidence|twap|interval|stale|settl/i;

function revertReason(err: unknown): string | null {
    const e = err as any;
    const reason = e?.reason ?? e?.revert?.args?.[0] ?? e?.info?.error?.message ?? e?.shortMessage;
    return typeof reason === "string" ? reason : null;
}

function isTransientError(err: unknown, selector: string): boolean {
    if (TRANSIENT_SELECTORS.has(selector)) return true;
    if (selector === "0x08c379a0") {
        const reason = revertReason(err);
        if (reason && TRANSIENT_REASON_PATTERNS.test(reason)) return true;
    }
    if (selector === "n/a") {
        const text = errorText(err);
        if (/timeout|timed out|dropped|replaced|nonce|mempool|not mined|could not coalesce/i.test(text)) return true;
    }
    return false;
}

function isTerminalExecuteError(err: unknown): boolean {
    const selector = selectorFromError(err);
    if (!selector) return false;

    const terminalSelectors = new Set([
        "0xd36d8965", // OrderNotFound()
        "0x08c379a0", // Error(string)
        "0x9165f13e", // InsufficientMargin
        "0xfb8eb1b3", // MaxLeverageExceeded
        "0xa0caf76c", // PositionSizeTooSmall
        "0xe372871f", // SlippageExceeded
        "0xbea3c635", // MarketNotActive
        "0xab63ac46", // MaxPositionSizeExceeded
        "0x19abf40e", // StalePrice
    ]);
    return terminalSelectors.has(selector);
}

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

    const pollMs = toMsFromSeconds(process.env.KEEPER_POLL_INTERVAL_SECONDS, 1);
    const idlePollMs = toMsFromSeconds(process.env.KEEPER_IDLE_POLL_INTERVAL_SECONDS, 1);
    const keeperApiBaseUrl = process.env.KEEPER_API_BASE_URL || "http://localhost:3001";
    const lookbackBlocks = BigInt(Math.max(1, Number(process.env.KEEPER_LOOKBACK_BLOCKS ?? "5000")));
    const blockChunkSize = BigInt(Math.max(100, Number(process.env.KEEPER_BLOCK_CHUNK_SIZE ?? "500")));
    const confirmations = BigInt(Math.max(0, Number(process.env.KEEPER_CONFIRMATIONS ?? "0")));
    const hermesBase = (process.env.KEEPER_HERMES_URL || "https://hermes.pyth.network").replace(/\/+$/, "");
    const rpcRetryBaseDelayMs = Math.max(100, Number(process.env.KEEPER_RPC_RETRY_BASE_DELAY_MS ?? "300"));
    const maxConcurrency = Math.max(1, Number(process.env.KEEPER_MAX_CONCURRENCY ?? "4"));
    const maxOrderAttempts = Math.max(1, Number(process.env.KEEPER_MAX_ORDER_ATTEMPTS ?? "5"));
    const txWaitTimeoutMs = toMsFromSeconds(process.env.KEEPER_TX_WAIT_TIMEOUT_SECONDS, 120);
    const transientBackoffMs = toMsFromSeconds(process.env.KEEPER_TRANSIENT_RETRY_SECONDS, 15);

    const rpcUrls = parseBotRpcUrls(rpcUrl, process.env.KEEPER_RPC_URLS);
    const rpcPause = new RpcPause();
    let rpcIndex = 0;
    let provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
    let baseWallet = new ethers.Wallet(privateKey, provider);
    let wallet: ethers.Signer = new ethers.NonceManager(baseWallet);
    const iface = new ethers.Interface([ORDER_CREATED_EVENT, ORDER_EXECUTED_EVENT, ORDER_CANCELLED_EVENT]);
    let tradingCore = new ethers.Contract(tradingCoreAddress, EXECUTE_ORDER_ABI, wallet);

    const createdTopic = iface.getEvent("OrderCreated").topicHash;
    const executedTopic = iface.getEvent("OrderExecuted").topicHash;
    const cancelledTopic = iface.getEvent("OrderCancelled").topicHash;

    let pyth: ethers.Contract;
    let oracleAggregator: ethers.Contract;

    async function rotateRpc(reason: string) {
        if (rpcUrls.length <= 1) return;
        rpcIndex = (rpcIndex + 1) % rpcUrls.length;
        provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
        baseWallet = new ethers.Wallet(privateKey, provider);
        wallet = new ethers.NonceManager(baseWallet);
        tradingCore = new ethers.Contract(tradingCoreAddress, EXECUTE_ORDER_ABI, wallet);
        if (oracleAggregator) oracleAggregator = oracleAggregator.connect(wallet) as ethers.Contract;
        if (pyth) pyth = pyth.connect(wallet) as ethers.Contract;
        console.warn(`[keeper] switched rpc -> ${rpcUrls[rpcIndex]} (reason: ${reason})`);
    }

    const withRpcRetry = createRpcRetry({
        logPrefix: "keeper",
        maxAttempts: Math.max(1, Number(process.env.KEEPER_RPC_MAX_ATTEMPTS ?? "3")),
        baseDelayMs: rpcRetryBaseDelayMs,
        rpcPause,
        rotateRpc,
    });

    function resyncNonce(): void {
        const nm = wallet as ethers.NonceManager;
        if (typeof nm.reset === "function") nm.reset();
    }

    async function waitForReceipt(tx: ethers.TransactionResponse): Promise<ethers.TransactionReceipt | null> {
        return tx.wait(1, txWaitTimeoutMs);
    }

    const marketFeedCache = new Map<string, string>();
    const pending = new Map<string, PendingOrder>();
    const inFlight = new Set<string>();
    const heartbeatMs = toMsFromSeconds(process.env.KEEPER_HEARTBEAT_SECONDS, 30);
    let lastHeartbeat = 0;

    let shuttingDown = false;
    const beginShutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[keeper] received ${signal}; draining in-flight work then exiting...`);
        setTimeout(() => process.exit(0), txWaitTimeoutMs + 5_000).unref();
    };

    process.on("SIGTERM", () => beginShutdown("SIGTERM"));
    process.on("SIGINT", () => beginShutdown("SIGINT"));

    console.log("[keeper] starting");
    console.log("[keeper] fetching network info...");
    const networkInfo = await withRpcRetry(() => provider.getNetwork(), "getNetwork");
    console.log(`[keeper] network info fetched: chainId=${networkInfo.chainId}`);

    console.log("[keeper] fetching latest block number...");
    const latest = await withRpcRetry(() => provider.getBlockNumber(), "getBlockNumber");
    console.log(`[keeper] latest block: ${latest}`);

    let cursor = BigInt(Math.max(0, latest - Number(lookbackBlocks)));
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
    console.log(
        `[keeper] backfill start=${cursor.toString()} source=${startSource} (replaying to discover resting orders)`,
    );

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

    async function processOrder(order: PendingOrder): Promise<void> {
        const key = order.id.toString();
        order.attempts += 1;
        try {
            const feedId = await getFeedIdForMarket(order.market);
            let updateData: string[] = [];
            let updateFee = 0n;

            if (feedId) {
                try {
                    const fetched = await fetchHermesUpdateData(feedId);
                    if (fetched && fetched.length > 0) {
                        updateData = fetched;
                        updateFee = (await withRpcRetry(() => pyth.getUpdateFee(updateData), "pyth.getUpdateFee")) as bigint;
                        console.log(`[keeper] order=${key} market=${order.market} fetched updateData, fee=${updateFee.toString()} wei`);
                    }
                } catch (hermesErr) {
                    console.warn(`[keeper] could not fetch Pyth update for market=${order.market}, proceeding with empty updateData:`, hermesErr);
                }
            }

            // ATOMIC EXECUTION: Pass the updateData and the updateFee in the single execution transaction
            const tx = await tradingCore.executeOrder(order.id, updateData, { value: updateFee });
            console.log(`[keeper] execute sent order=${key} tx=${tx.hash}`);
            const receipt = await waitForReceipt(tx);
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

            if (isTransientError(err, selector)) {
                order.attempts -= 1;
                order.nextAttemptAt = Date.now() + transientBackoffMs;
                console.log(
                    `[keeper] order=${key} not yet executable (selector=${selector}); retry in ${transientBackoffMs}ms`,
                );
                return;
            }

            if (isTerminalExecuteError(err)) {
                pending.delete(key);
                await reportKeeperFailure(keeperApiBaseUrl, order.id, order.account, order.market, message, selector);
                return;
            }

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

    // Ultra-fast background worker dispatcher
    function dispatchPendingOrders() {
        if (shuttingDown) return;
        const now = Date.now();
        const readyOrders = [...pending.values()]
            .filter((o) => !inFlight.has(o.id.toString()) && o.nextAttemptAt <= now)
            .sort((a, b) => (a.id < b.id ? -1 : 1));

        while (inFlight.size < maxConcurrency && readyOrders.length > 0) {
            const order = readyOrders.shift()!;
            const key = order.id.toString();
            inFlight.add(key);

            // Execute order in the background asynchronously
            (async () => {
                try {
                    await processOrder(order);
                } catch (err) {
                    console.error(`[keeper] fatal worker error for order=${key}:`, err);
                } finally {
                    inFlight.delete(key);
                    // Re-trigger dispatching as slots open up
                    dispatchPendingOrders();
                }
            })();
        }
    }

    while (!shuttingDown) {
        try {
            resyncNonce();

            let head: bigint;
            try {
                head = BigInt(await withRpcRetry(() => provider.getBlockNumber(), "loop:getBlockNumber"));
            } catch (rpcErr) {
                if (await backoffMainLoop(rpcPause, rpcErr, "keeper", rpcRetryBaseDelayMs, "loop:getBlockNumber")) {
                    continue;
                }
                throw rpcErr;
            }

            const safeHead = head > confirmations ? head - confirmations : 0n;
            let logsFoundThisTick = 0;

            if (safeHead > cursor) {
                let from = cursor + 1n;
                while (from <= safeHead) {
                    const to = from + blockChunkSize > safeHead ? safeHead : from + blockChunkSize;
                    if (to < from) break;

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
                                nextAttemptAt: 0,
                            });
                            console.log(
                                `[keeper] discovered order=${id.toString()} market=${market} block=${log.blockNumber}`,
                            );
                        } else {
                            pending.delete(id.toString());
                        }
                    }

                    cursor = to;
                    from = to + 1n;
                }
            }

            const nowMs = Date.now();
            if (logsFoundThisTick > 0 || nowMs - lastHeartbeat >= heartbeatMs) {
                lastHeartbeat = nowMs;
                console.log(
                    `[keeper] heartbeat head=${head.toString()} scannedTo=${cursor.toString()} pending=${pending.size} logsThisTick=${logsFoundThisTick}`,
                );
            }

            // Asynchronously dispatch any pending orders (non-blocking)
            if (pending.size > 0) {
                dispatchPendingOrders();
            }
        } catch (err) {
            if (await backoffMainLoop(rpcPause, err, "keeper", rpcRetryBaseDelayMs)) {
                continue;
            }
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[keeper] loop error: ${message}`);
        }

        const loopDelay = pending.size > 0 ? pollMs : idlePollMs;
        await sleepMs(loopDelay);
    }

    console.log("[keeper] drained; exiting.");
    process.exit(0);
}

main().catch((err) => {
    console.error("[keeper] fatal:", err);
    process.exit(1);
});
