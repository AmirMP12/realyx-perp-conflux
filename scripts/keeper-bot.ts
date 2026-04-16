import "dotenv/config";
import { ethers } from "ethers";
import { loadDeployment } from "./write-deployment";

type PendingOrder = {
    id: bigint;
    createdAtBlock: bigint;
    market: string;
};

const ORDER_CREATED_EVENT =
    "event OrderCreated(uint256 indexed orderId, address indexed account, uint8 orderType, address market)";
const ORDER_EXECUTED_EVENT = "event OrderExecuted(uint256 indexed orderId, uint256 positionId, address indexed keeper)";
const ORDER_CANCELLED_EVENT = "event OrderCancelled(uint256 indexed orderId, string reason)";

const EXECUTE_ORDER_ABI = [
    "function executeOrder(uint256 orderId, bytes[] calldata updateData) external",
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

function getEnv(name: string, fallback?: string): string {
    const value = process.env[name] ?? fallback;
    if (!value) throw new Error(`${name} is required`);
    return value;
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

function isRetriableRpcError(err: unknown): boolean {
    const text = err instanceof Error ? `${err.message} ${(err as any).code ?? ""}` : String(err);
    return /timeout|rate exceeded|too many requests|429|ETIMEDOUT|SERVER_ERROR/i.test(text);
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
    ]);
    return terminalSelectors.has(selector);
}

function bytes32ToPythId(feedId: string): string {
    return feedId.toLowerCase().replace(/^0x/, "");
}

async function main() {
    const network = process.env.KEEPER_NETWORK || process.env.HARDHAT_NETWORK || "confluxTestnet";
    const deployment = loadDeployment(network);

    const rpcUrl = getEnv("KEEPER_RPC_URL", process.env.CONFLUX_TESTNET_RPC_URL || process.env.CONFLUX_RPC_URL);
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
    const lookbackBlocks = BigInt(Math.max(1, Number(process.env.KEEPER_LOOKBACK_BLOCKS ?? "20000")));
    const blockChunkSize = BigInt(Math.max(100, Number(process.env.KEEPER_BLOCK_CHUNK_SIZE ?? "4000")));
    const hermesBase = (process.env.KEEPER_HERMES_URL || "https://hermes.pyth.network").replace(/\/+$/, "");
    const rpcRetryBaseDelayMs = Math.max(100, Number(process.env.KEEPER_RPC_RETRY_BASE_DELAY_MS ?? "300"));

    const rpcUrls = parseRpcUrls(rpcUrl);
    let rpcIndex = 0;
    let provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
    let wallet = new ethers.Wallet(privateKey, provider);
    const iface = new ethers.Interface([ORDER_CREATED_EVENT, ORDER_EXECUTED_EVENT, ORDER_CANCELLED_EVENT]);
    let tradingCore = new ethers.Contract(tradingCoreAddress, EXECUTE_ORDER_ABI, wallet);

    const createdTopic = iface.getEvent("OrderCreated").topicHash;
    const executedTopic = iface.getEvent("OrderExecuted").topicHash;
    const cancelledTopic = iface.getEvent("OrderCancelled").topicHash;

    async function rotateRpc(reason: string) {
        if (rpcUrls.length <= 1) return;
        rpcIndex = (rpcIndex + 1) % rpcUrls.length;
        provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
        wallet = new ethers.Wallet(privateKey, provider);
        tradingCore = new ethers.Contract(tradingCoreAddress, EXECUTE_ORDER_ABI, wallet);
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
                await new Promise((r) => setTimeout(r, rpcRetryBaseDelayMs * i));
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
    const pending = new Map<string, PendingOrder>();

    console.log(`[keeper] chainId=${networkInfo.chainId.toString()} rpc=${rpcUrls[rpcIndex]}`);
    console.log(`[keeper] wallet=${wallet.address}`);
    console.log(`[keeper] tradingCore=${tradingCoreAddress}`);
    console.log(`[keeper] startBlock=${cursor.toString()} pollMs=${pollMs}`);

    console.log("[keeper] checking KEEPER_ROLE...");

    const hasKeeperRole = await tradingCore.hasRole(KEEPER_ROLE, wallet.address);
    if (!hasKeeperRole) {
        throw new Error(
            `Wallet ${wallet.address} is missing KEEPER_ROLE (${KEEPER_ROLE}) on TradingCore ${tradingCoreAddress}.`,
        );
    }
    console.log("[keeper] KEEPER_ROLE verified.");

    console.log("[keeper] fetching OracleAggregator address...");
    const oracleAggregatorAddress = await withRpcRetry(
        () => tradingCore.oracleAggregator(),
        "tradingCore.oracleAggregator",
    );
    console.log(`[keeper] oracleAggregator=${oracleAggregatorAddress}`);
    const oracleAggregator = new ethers.Contract(oracleAggregatorAddress, ORACLE_AGGREGATOR_ABI, wallet);

    console.log("[keeper] fetching Pyth address...");
    const pythAddress = await withRpcRetry(() => oracleAggregator.pyth(), "oracleAggregator.pyth");
    console.log(`[keeper] pythAddress=${pythAddress}`);
    const pyth = new ethers.Contract(pythAddress, PYTH_ABI, wallet);

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

    while (true) {
        try {
            const currentBlock = BigInt(await withRpcRetry(() => provider.getBlockNumber(), "loop:getBlockNumber"));
            if (currentBlock > cursor) {
                let from = cursor + 1n;
                while (from <= currentBlock) {
                    const to = from + blockChunkSize > currentBlock ? currentBlock : from + blockChunkSize;

                    const createdLogs = await withRpcRetry(
                        () =>
                            provider.getLogs({
                                address: tradingCoreAddress,
                                fromBlock: from,
                                toBlock: to,
                                topics: [createdTopic],
                            }),
                        "getLogs:created",
                    );
                    const executedLogs = await withRpcRetry(
                        () =>
                            provider.getLogs({
                                address: tradingCoreAddress,
                                fromBlock: from,
                                toBlock: to,
                                topics: [executedTopic],
                            }),
                        "getLogs:executed",
                    );
                    const cancelledLogs = await withRpcRetry(
                        () =>
                            provider.getLogs({
                                address: tradingCoreAddress,
                                fromBlock: from,
                                toBlock: to,
                                topics: [cancelledTopic],
                            }),
                        "getLogs:cancelled",
                    );

                    for (const log of createdLogs) {
                        const parsed = iface.parseLog(log);
                        const id = parsed?.args?.orderId as bigint | undefined;
                        if (id == null) continue;
                        const market = (parsed?.args?.market as string | undefined) || ethers.ZeroAddress;
                        pending.set(id.toString(), { id, market, createdAtBlock: BigInt(log.blockNumber) });
                    }

                    for (const log of [...executedLogs, ...cancelledLogs]) {
                        const parsed = iface.parseLog(log);
                        const id = parsed?.args?.orderId as bigint | undefined;
                        if (id == null) continue;
                        pending.delete(id.toString());
                    }

                    from = to + 1n;
                }
                cursor = currentBlock;
            }

            if (pending.size > 0) {
                const orders = [...pending.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
                console.log(`[keeper] pending=${orders.length} newestBlock=${cursor.toString()}`);

                for (const order of orders) {
                    try {
                        // Ensure on-chain Pyth cache is refreshed for this market before execution.
                        await refreshPythForMarket(order.market);

                        const tx = await tradingCore.executeOrder(order.id, []);
                        console.log(`[keeper] execute sent order=${order.id.toString()} tx=${tx.hash}`);
                        const receipt = await tx.wait();
                        if (receipt?.status === 1) {
                            pending.delete(order.id.toString());
                            console.log(`[keeper] executed order=${order.id.toString()} block=${receipt.blockNumber}`);
                        } else {
                            console.warn(`[keeper] tx reverted order=${order.id.toString()} tx=${tx.hash}`);
                        }
                    } catch (err) {
                        const selector = selectorFromError(err) ?? "n/a";
                        const message = err instanceof Error ? err.message : String(err);
                        console.warn(
                            `[keeper] execute failed order=${order.id.toString()} selector=${selector} msg=${message}`,
                        );

                        // If stale price, force refresh and retry once immediately.
                        if (selector === STALE_PRICE_SELECTOR) {
                            try {
                                const refreshed = await refreshPythForMarket(order.market, true);
                                if (refreshed) {
                                    const retryTx = await tradingCore.executeOrder(order.id, []);
                                    console.log(
                                        `[keeper] retry execute sent order=${order.id.toString()} tx=${retryTx.hash}`,
                                    );
                                    const retryReceipt = await retryTx.wait();
                                    if (retryReceipt?.status === 1) {
                                        pending.delete(order.id.toString());
                                        console.log(
                                            `[keeper] executed on retry order=${order.id.toString()} block=${retryReceipt.blockNumber}`,
                                        );
                                        continue;
                                    }
                                }
                            } catch (retryErr) {
                                const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                                console.warn(
                                    `[keeper] stale-price retry failed order=${order.id.toString()} msg=${retryMsg}`,
                                );
                            }
                        }

                        // Remove from queue only when no longer executable.
                        if (isTerminalExecuteError(err)) {
                            pending.delete(order.id.toString());
                        }
                    }
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
