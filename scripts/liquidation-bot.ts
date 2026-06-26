import "dotenv/config";
import { ethers } from "ethers";
import { loadDeployment } from "./write-deployment";

/**
 * Liquidation keeper.
 *
 * Solvency previously depended on an allow-listed `LIQUIDATOR_ROLE` holder with
 * no runner shipped in-repo. This bot closes that gap: it enumerates open
 * positions, asks the chain whether each is liquidatable at the current oracle
 * snapshot, refreshes Pyth, and calls `liquidatePosition`.
 *
 * It deliberately mirrors `keeper-bot.ts`: multi-RPC failover, stale-price
 * refresh-and-retry, and graceful shutdown. It is a safety backstop that
 * complements the permissionless liquidation path, removing the "no automation
 * exists" risk immediately.
 *
 * Position discovery strategy (no global open-position enumeration exists
 * on-chain): scan a trailing window of `PositionOpened` events, drop ids that
 * later emit `PositionClosed`/`PositionLiquidated`, and re-check the survivors
 * each tick via `canLiquidate`. For production scale, point `LIQ_API_BASE_URL`
 * at the indexer's open-positions endpoint instead of the event scan.
 */

const ORDER_OPENED_EVENT =
    "event PositionOpened(uint256 indexed positionId, address indexed trader, address indexed market, bool isLong, uint256 size, uint256 leverage, uint256 entryPrice)";
const ORDER_CLOSED_EVENT =
    "event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnL, uint256 exitPrice, uint256 closingFee)";
const ORDER_LIQUIDATED_EVENT =
    "event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 liquidationFee)";

const TRADING_CORE_ABI = [
    "function liquidatePosition(uint256 positionId) external returns (uint256 liquidatorReward)",
    "function canLiquidate(uint256 positionId) external view returns (bool, uint256 healthFactor)",
    "function getPosition(uint256 positionId) external view returns (tuple(uint128 size, uint128 entryPrice, uint128 liquidationPrice, uint128 stopLossPrice, uint128 takeProfitPrice, uint128 leverage, address market, uint40 openTimestamp, uint16 trailingStopBps, uint8 flags, uint8 collateralType, uint8 state, address collateralToken, uint64 lastFundingTime))",
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

const LIQUIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE"));
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const STALE_PRICE_SELECTOR = "0x19abf40e";
const POS_STATUS_OPEN = 1; // DataTypes.PosStatus.OPEN (NONE=0, OPEN=1, ...)

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
    const csv = process.env.LIQ_RPC_URLS ?? process.env.KEEPER_RPC_URLS;
    const list = (csv ? csv.split(",") : [primary]).map((s) => s.trim()).filter(Boolean);
    return [...new Set(list)];
}

function bytes32ToPythId(feedId: string): string {
    return feedId.toLowerCase().replace(/^0x/, "");
}

async function main() {
    const network =
        process.env.LIQ_NETWORK || process.env.KEEPER_NETWORK || process.env.HARDHAT_NETWORK || "confluxTestnet";
    const deployment = loadDeployment(network);

    const rpcUrl = getEnv(
        "LIQ_RPC_URL",
        process.env.KEEPER_RPC_URL || process.env.CONFLUX_TESTNET_RPC_URL || process.env.CONFLUX_RPC_URL,
    );
    const privateKey = getEnv("LIQ_PRIVATE_KEY", process.env.KEEPER_PRIVATE_KEY || process.env.PRIVATE_KEY);
    const tradingCoreAddress =
        process.env.LIQ_TRADING_CORE_ADDRESS ||
        process.env.KEEPER_TRADING_CORE_ADDRESS ||
        process.env.DEPLOYED_TRADING_CORE ||
        deployment?.contracts?.tradingCore;

    if (!tradingCoreAddress) {
        throw new Error("Set LIQ_TRADING_CORE_ADDRESS or DEPLOYED_TRADING_CORE (or deployment/<network>.json)");
    }

    const pollMs = toMsFromSeconds(process.env.LIQ_POLL_INTERVAL_SECONDS, 5);
    const minPriceRefreshMs = toMsFromSeconds(process.env.LIQ_MIN_PRICE_REFRESH_SECONDS, 20);
    const lookbackBlocks = BigInt(Math.max(1, Number(process.env.LIQ_LOOKBACK_BLOCKS ?? "50000")));
    const blockChunkSize = BigInt(Math.max(100, Number(process.env.LIQ_BLOCK_CHUNK_SIZE ?? "500")));
    const hermesBase = (
        process.env.LIQ_HERMES_URL ||
        process.env.KEEPER_HERMES_URL ||
        "https://hermes.pyth.network"
    ).replace(/\/+$/, "");
    const rpcRetryBaseDelayMs = Math.max(100, Number(process.env.LIQ_RPC_RETRY_BASE_DELAY_MS ?? "300"));

    const rpcUrls = parseRpcUrls(rpcUrl);
    let rpcIndex = 0;
    let provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
    let wallet = new ethers.Wallet(privateKey, provider);
    const iface = new ethers.Interface([ORDER_OPENED_EVENT, ORDER_CLOSED_EVENT, ORDER_LIQUIDATED_EVENT]);
    let tradingCore = new ethers.Contract(tradingCoreAddress, TRADING_CORE_ABI, wallet);

    const openedTopic = iface.getEvent("PositionOpened").topicHash;
    const closedTopic = iface.getEvent("PositionClosed").topicHash;
    const liquidatedTopic = iface.getEvent("PositionLiquidated").topicHash;

    async function rotateRpc(reason: string) {
        if (rpcUrls.length <= 1) return;
        rpcIndex = (rpcIndex + 1) % rpcUrls.length;
        provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
        wallet = new ethers.Wallet(privateKey, provider);
        tradingCore = new ethers.Contract(tradingCoreAddress, TRADING_CORE_ABI, wallet);
        console.warn(`[liq] switched rpc -> ${rpcUrls[rpcIndex]} (reason: ${reason})`);
    }

    async function withRpcRetry<T>(fn: () => Promise<T>, op: string): Promise<T> {
        const maxAttempts = Math.max(1, Number(process.env.LIQ_RPC_MAX_ATTEMPTS ?? "3"));
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
        console.log("[liq] Received SIGTERM. Shutting down gracefully...");
        process.exit(0);
    });
    process.on("SIGINT", () => {
        console.log("[liq] Received SIGINT. Shutting down...");
        process.exit(0);
    });

    console.log("[liq] starting");
    const networkInfo = await withRpcRetry(() => provider.getNetwork(), "getNetwork");
    const latest = await withRpcRetry(() => provider.getBlockNumber(), "getBlockNumber");

    let cursor = BigInt(Math.max(0, latest - Number(lookbackBlocks)));
    // Candidate open positions: id -> market. Pruned as close/liquidate logs arrive.
    const candidates = new Map<string, string>();

    console.log(`[liq] chainId=${networkInfo.chainId.toString()} rpc=${rpcUrls[rpcIndex]}`);
    console.log(`[liq] wallet=${wallet.address}`);
    console.log(`[liq] tradingCore=${tradingCoreAddress}`);
    console.log(`[liq] startBlock=${cursor.toString()} pollMs=${pollMs}`);

    const hasRole = await withRpcRetry(() => tradingCore.hasRole(LIQUIDATOR_ROLE, wallet.address), "hasRole");
    if (!hasRole) {
        throw new Error(
            `Wallet ${wallet.address} is missing LIQUIDATOR_ROLE (${LIQUIDATOR_ROLE}) on TradingCore ${tradingCoreAddress}.`,
        );
    }
    console.log("[liq] LIQUIDATOR_ROLE verified.");

    const oracleAggregatorAddress = await withRpcRetry(() => tradingCore.oracleAggregator(), "oracleAggregator");
    const oracleAggregator = new ethers.Contract(oracleAggregatorAddress, ORACLE_AGGREGATOR_ABI, wallet);
    const pythAddress = await withRpcRetry(() => oracleAggregator.pyth(), "pyth");
    const pyth = new ethers.Contract(pythAddress, PYTH_ABI, wallet);
    console.log(`[liq] oracleAggregator=${oracleAggregatorAddress} pyth=${pythAddress}`);
    console.log("[liq] entering main loop...");

    async function getFeedIdForMarket(market: string): Promise<string | null> {
        const key = market.toLowerCase();
        const cached = marketFeedCache.get(key);
        if (cached) return cached;
        const [feedId] = (await withRpcRetry(() => oracleAggregator.getOracleConfig(market), "getOracleConfig")) as [
            string,
            bigint,
            bigint,
            bigint,
        ];
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
        const updateFee = (await withRpcRetry(() => pyth.getUpdateFee(updateData), "getUpdateFee")) as bigint;
        const tx = await pyth.updatePriceFeeds(updateData, { value: updateFee });
        await tx.wait();
        lastRefreshByMarket.set(key, now);
        console.log(`[liq] refreshed pyth market=${market} tx=${tx.hash}`);
        return true;
    }

    async function tryLiquidate(positionId: string, market: string): Promise<void> {
        // Refresh oracle first so canLiquidate and the tx see a fresh price.
        try {
            await refreshPythForMarket(market);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[liq] pyth refresh failed market=${market} msg=${msg}`);
        }

        let liquidatable = false;
        try {
            const [can] = (await withRpcRetry(() => tradingCore.canLiquidate(positionId), "canLiquidate")) as [
                boolean,
                bigint,
            ];
            liquidatable = can;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[liq] canLiquidate failed id=${positionId} msg=${msg}`);
            return;
        }
        if (!liquidatable) return;

        try {
            const tx = await tradingCore.liquidatePosition(positionId);
            console.log(`[liq] liquidate sent id=${positionId} tx=${tx.hash}`);
            const receipt = await tx.wait();
            if (receipt?.status === 1) {
                candidates.delete(positionId);
                console.log(`[liq] liquidated id=${positionId} block=${receipt.blockNumber}`);
            } else {
                console.warn(`[liq] tx reverted id=${positionId} tx=${tx.hash}`);
            }
        } catch (err) {
            const selector = selectorFromError(err) ?? "n/a";
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[liq] liquidate failed id=${positionId} selector=${selector} msg=${message}`);
            if (selector === STALE_PRICE_SELECTOR) {
                try {
                    const refreshed = await refreshPythForMarket(market, true);
                    if (refreshed) {
                        const retryTx = await tradingCore.liquidatePosition(positionId);
                        const retryReceipt = await retryTx.wait();
                        if (retryReceipt?.status === 1) {
                            candidates.delete(positionId);
                            console.log(`[liq] liquidated on retry id=${positionId} block=${retryReceipt.blockNumber}`);
                        }
                    }
                } catch (retryErr) {
                    const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                    console.warn(`[liq] stale-price retry failed id=${positionId} msg=${retryMsg}`);
                }
            }
        }
    }

    while (true) {
        try {
            const currentBlock = BigInt(await withRpcRetry(() => provider.getBlockNumber(), "loop:getBlockNumber"));
            if (currentBlock > cursor) {
                let from = cursor + 1n;
                while (from <= currentBlock) {
                    const to = from + blockChunkSize > currentBlock ? currentBlock : from + blockChunkSize;
                    const [openedLogs, closedLogs, liquidatedLogs] = await Promise.all([
                        withRpcRetry(
                            () =>
                                provider.getLogs({
                                    address: tradingCoreAddress,
                                    fromBlock: from,
                                    toBlock: to,
                                    topics: [openedTopic],
                                }),
                            "getLogs:opened",
                        ),
                        withRpcRetry(
                            () =>
                                provider.getLogs({
                                    address: tradingCoreAddress,
                                    fromBlock: from,
                                    toBlock: to,
                                    topics: [closedTopic],
                                }),
                            "getLogs:closed",
                        ),
                        withRpcRetry(
                            () =>
                                provider.getLogs({
                                    address: tradingCoreAddress,
                                    fromBlock: from,
                                    toBlock: to,
                                    topics: [liquidatedTopic],
                                }),
                            "getLogs:liquidated",
                        ),
                    ]);

                    for (const log of openedLogs) {
                        const parsed = iface.parseLog(log);
                        const id = parsed?.args?.positionId as bigint | undefined;
                        if (id == null) continue;
                        const market = (parsed?.args?.market as string | undefined) || ethers.ZeroAddress;
                        candidates.set(id.toString(), market);
                    }
                    for (const log of [...closedLogs, ...liquidatedLogs]) {
                        const parsed = iface.parseLog(log);
                        const id = parsed?.args?.positionId as bigint | undefined;
                        if (id == null) continue;
                        candidates.delete(id.toString());
                    }
                    from = to + 1n;
                }
                cursor = currentBlock;
            }

            if (candidates.size > 0) {
                console.log(`[liq] candidates=${candidates.size} newestBlock=${cursor.toString()}`);
                for (const [positionId, market] of [...candidates.entries()]) {
                    // Confirm still open before doing oracle work (cheap guard against
                    // races where our event window missed the close).
                    try {
                        const pos = await withRpcRetry(() => tradingCore.getPosition(positionId), "getPosition");
                        if (Number(pos.state) !== POS_STATUS_OPEN) {
                            candidates.delete(positionId);
                            continue;
                        }
                        await tryLiquidate(positionId, market || pos.market);
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        console.warn(`[liq] candidate check failed id=${positionId} msg=${msg}`);
                    }
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[liq] loop error: ${message}`);
        }

        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}

main().catch((err) => {
    console.error("[liq] fatal:", err);
    process.exit(1);
});
