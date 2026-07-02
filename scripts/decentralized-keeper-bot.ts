import "dotenv/config";
import { ethers } from "ethers";
import { RpcPause, backoffMainLoop, createRpcRetry, parseBotRpcUrls, sleepMs } from "./lib/bot-rpc";
import { loadDeployment } from "./write-deployment";

/**
 * Realyx decentralized keeper bot.
 *
 * Unlike `keeper-bot.ts` / `liquidation-bot.ts` (which call `TradingCore`
 * directly and therefore require an allow-listed `KEEPER_ROLE` /
 * `LIQUIDATOR_ROLE` wallet), this bot drives the permissionless
 * `KeeperNetwork` module. The KeeperNetwork holds the privileged roles on the
 * core and re-exposes the keeper actions to anyone (optionally stake-gated),
 * forwarding the Pyth update-fee refund + the core's keeper execution fee +
 * a governance-funded native bounty back to the caller.
 *
 * It covers all three permissionless entry points in one process:
 *   - executeOrder   — execute resting limit/stop orders.
 *   - executeTriggers— self-execute stop-loss / take-profit / trailing-stop
 *                      (the core checks conditions on-chain; we just feed it
 *                      candidate open positions that have a trigger set).
 *   - liquidate      — close underwater positions (intentionally never paused).
 *
 * The KeeperNetwork takes the Pyth `updateData` and the update fee as
 * `msg.value`, so this bot fetches Hermes payloads and computes the fee rather
 * than pushing prices itself. Liveness hardening mirrors the other bots:
 * multi-RPC failover, stale-price refresh-and-retry, NonceManager-backed signer
 * for concurrent sends, and graceful shutdown.
 *
 * Eligibility: in permissionless mode anyone can execute. Otherwise the bot can
 * auto-register and post `DK_STAKE_AMOUNT` (>= the network `minStake`) on start
 * when `DK_AUTO_STAKE=true`.
 */

// --- TradingCore events (order + position lifecycle, read from the core) ---
const ORDER_CREATED_EVENT =
    "event OrderCreated(uint256 indexed orderId, address indexed account, uint8 orderType, address market)";
const ORDER_EXECUTED_EVENT = "event OrderExecuted(uint256 indexed orderId, uint256 positionId, address indexed keeper)";
const ORDER_CANCELLED_EVENT = "event OrderCancelled(uint256 indexed orderId, string reason)";
const POSITION_OPENED_EVENT =
    "event PositionOpened(uint256 indexed positionId, address indexed trader, address indexed market, bool isLong, uint256 size, uint256 leverage, uint256 entryPrice)";
const POSITION_CLOSED_EVENT =
    "event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnL, uint256 exitPrice, uint256 closingFee)";
const POSITION_LIQUIDATED_EVENT =
    "event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 liquidationPrice, uint256 liquidationFee)";

// --- KeeperNetwork (permissionless self-execution router) ---
const KEEPER_NETWORK_ABI = [
    "function executeOrder(uint256 orderId, bytes[] calldata updateData) external payable returns (uint256 nativePaid)",
    "function executeTriggers(uint256[] calldata positionIds, bytes[] calldata updateData) external payable returns (uint256 processed)",
    "function liquidate(uint256 positionId, bytes[] calldata updateData) external payable returns (uint256 usdcReward, uint256 nativePaid)",
    "function canLiquidate(uint256 positionId) external view returns (bool can, uint256 healthFactor)",
    "function isEligible(address account) external view returns (bool)",
    "function permissionlessMode() external view returns (bool)",
    "function minStake() external view returns (uint256)",
    "function rewardPool() external view returns (uint256)",
    "function registerKeeper() external payable",
    "function keepers(address) external view returns (bool active, uint64 registeredAt, uint64 executions, uint256 stake, uint256 earnedNative, uint64 unstakeReadyAt)",
    "function tradingCore() external view returns (address)",
];

// --- Read-only views on the core / oracle ---
const TRADING_CORE_VIEW_ABI = [
    "function getPosition(uint256 positionId) external view returns (tuple(uint128 size, uint128 entryPrice, uint128 liquidationPrice, uint128 stopLossPrice, uint128 takeProfitPrice, uint128 leverage, address market, uint40 openTimestamp, uint16 trailingStopBps, uint8 flags, uint8 collateralType, uint8 state, address collateralToken, uint64 lastFundingTime))",
    "function oracleAggregator() external view returns (address)",
];
const ORACLE_AGGREGATOR_ABI = [
    "function pyth() external view returns (address)",
    "function getOracleConfig(address collection) external view returns (bytes32, uint256, uint256, uint256)",
];
const PYTH_ABI = ["function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)"];

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const STALE_PRICE_SELECTOR = "0x19abf40e";
const POS_STATUS_OPEN = 1; // DataTypes.PosStatus.OPEN (NONE=0, OPEN=1, ...)

type PendingOrder = {
    id: bigint;
    market: string;
    account: string;
    attempts: number;
};

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

function bytes32ToPythId(feedId: string): string {
    return feedId.toLowerCase().replace(/^0x/, "");
}

async function main() {
    const network =
        process.env.DK_NETWORK || process.env.KEEPER_NETWORK || process.env.HARDHAT_NETWORK || "confluxTestnet";
    const deployment = loadDeployment(network);

    const rpcUrl = getEnv(
        "DK_RPC_URL",
        process.env.KEEPER_RPC_URL || process.env.CONFLUX_TESTNET_RPC_URL || process.env.CONFLUX_RPC_URL,
    );
    const privateKey = getEnv("DK_PRIVATE_KEY", process.env.KEEPER_PRIVATE_KEY || process.env.PRIVATE_KEY);

    const keeperNetworkAddress =
        process.env.DK_KEEPER_NETWORK_ADDRESS ||
        process.env.KEEPER_NETWORK_ADDRESS ||
        deployment?.contracts?.keeperNetwork;
    if (!keeperNetworkAddress) {
        throw new Error("Set DK_KEEPER_NETWORK_ADDRESS or KEEPER_NETWORK_ADDRESS (deployed KeeperNetwork proxy).");
    }

    const pollMs = toMsFromSeconds(process.env.DK_POLL_INTERVAL_SECONDS, 6);
    const idlePollMs = toMsFromSeconds(process.env.DK_IDLE_POLL_INTERVAL_SECONDS, 18);
    const lookbackBlocks = BigInt(Math.max(1, Number(process.env.DK_LOOKBACK_BLOCKS ?? "50000")));
    const blockChunkSize = BigInt(Math.max(100, Number(process.env.DK_BLOCK_CHUNK_SIZE ?? "500")));
    const hermesBase = (
        process.env.DK_HERMES_URL ||
        process.env.KEEPER_HERMES_URL ||
        "https://hermes.pyth.network"
    ).replace(/\/+$/, "");
    const rpcRetryBaseDelayMs = Math.max(100, Number(process.env.DK_RPC_RETRY_BASE_DELAY_MS ?? "300"));
    const maxConcurrency = Math.max(1, Number(process.env.DK_MAX_CONCURRENCY ?? "4"));
    const maxOrderAttempts = Math.max(1, Number(process.env.DK_MAX_ORDER_ATTEMPTS ?? "5"));
    const triggerBatchSize = Math.max(1, Number(process.env.DK_TRIGGER_BATCH_SIZE ?? "20"));
    // Pyth update fees are tiny but non-zero; this bounds what we'll forward as
    // msg.value per call so a misconfigured fee oracle can't drain the wallet.
    const maxUpdateFeeWei = BigInt(process.env.DK_MAX_UPDATE_FEE_WEI ?? ethers.parseEther("0.05").toString());
    const autoStake = (process.env.DK_AUTO_STAKE ?? "false").toLowerCase() === "true";
    const enableLiquidations = (process.env.DK_ENABLE_LIQUIDATIONS ?? "true").toLowerCase() !== "false";
    const enableTriggers = (process.env.DK_ENABLE_TRIGGERS ?? "true").toLowerCase() !== "false";
    const enableOrders = (process.env.DK_ENABLE_ORDERS ?? "true").toLowerCase() !== "false";

    const rpcUrls = parseBotRpcUrls(rpcUrl, process.env.DK_RPC_URLS ?? process.env.KEEPER_RPC_URLS);
    const rpcPause = new RpcPause();
    let rpcIndex = 0;
    let provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
    let baseWallet = new ethers.Wallet(privateKey, provider);
    // NonceManager hands out sequential nonces locally so several in-flight txs
    // (parallel order execution + trigger/liquidation batches) don't collide on
    // the same nonce under concurrency.
    let wallet: ethers.Signer = new ethers.NonceManager(baseWallet);

    const iface = new ethers.Interface([
        ORDER_CREATED_EVENT,
        ORDER_EXECUTED_EVENT,
        ORDER_CANCELLED_EVENT,
        POSITION_OPENED_EVENT,
        POSITION_CLOSED_EVENT,
        POSITION_LIQUIDATED_EVENT,
    ]);

    let keeperNetwork = new ethers.Contract(keeperNetworkAddress, KEEPER_NETWORK_ABI, wallet);
    let tradingCore: ethers.Contract;
    let oracleAggregator: ethers.Contract;
    let pyth: ethers.Contract;
    let tradingCoreAddress = "";

    const createdTopic = iface.getEvent("OrderCreated")!.topicHash;
    const executedTopic = iface.getEvent("OrderExecuted")!.topicHash;
    const cancelledTopic = iface.getEvent("OrderCancelled")!.topicHash;
    const openedTopic = iface.getEvent("PositionOpened")!.topicHash;
    const closedTopic = iface.getEvent("PositionClosed")!.topicHash;
    const liquidatedTopic = iface.getEvent("PositionLiquidated")!.topicHash;

    async function rotateRpc(reason: string) {
        if (rpcUrls.length <= 1) return;
        rpcIndex = (rpcIndex + 1) % rpcUrls.length;
        provider = new ethers.JsonRpcProvider(rpcUrls[rpcIndex]);
        baseWallet = new ethers.Wallet(privateKey, provider);
        wallet = new ethers.NonceManager(baseWallet);
        keeperNetwork = new ethers.Contract(keeperNetworkAddress, KEEPER_NETWORK_ABI, wallet);
        if (tradingCoreAddress) tradingCore = new ethers.Contract(tradingCoreAddress, TRADING_CORE_VIEW_ABI, wallet);
        if (oracleAggregator) oracleAggregator = oracleAggregator.connect(wallet) as ethers.Contract;
        if (pyth) pyth = pyth.connect(wallet) as ethers.Contract;
        console.warn(`[dkeeper] switched rpc -> ${rpcUrls[rpcIndex]} (reason: ${reason})`);
    }

    const withRpcRetry = createRpcRetry({
        logPrefix: "dkeeper",
        maxAttempts: Math.max(1, Number(process.env.DK_RPC_MAX_ATTEMPTS ?? "3")),
        baseDelayMs: rpcRetryBaseDelayMs,
        rpcPause,
        rotateRpc,
    });

    const marketFeedCache = new Map<string, string>();

    process.on("SIGTERM", () => {
        console.log("[dkeeper] Received SIGTERM. Shutting down gracefully...");
        process.exit(0);
    });
    process.on("SIGINT", () => {
        console.log("[dkeeper] Received SIGINT. Shutting down...");
        process.exit(0);
    });

    console.log("[dkeeper] starting");
    const networkInfo = await withRpcRetry(() => provider.getNetwork(), "getNetwork");
    const latest = await withRpcRetry(() => provider.getBlockNumber(), "getBlockNumber");

    tradingCoreAddress = await withRpcRetry(() => keeperNetwork.tradingCore(), "keeperNetwork.tradingCore");
    tradingCore = new ethers.Contract(tradingCoreAddress, TRADING_CORE_VIEW_ABI, wallet);

    const oracleAggregatorAddress = await withRpcRetry(
        () => tradingCore.oracleAggregator(),
        "tradingCore.oracleAggregator",
    );
    oracleAggregator = new ethers.Contract(oracleAggregatorAddress, ORACLE_AGGREGATOR_ABI, wallet);
    const pythAddress = await withRpcRetry(() => oracleAggregator.pyth(), "oracleAggregator.pyth");
    pyth = new ethers.Contract(pythAddress, PYTH_ABI, wallet);

    console.log(`[dkeeper] chainId=${networkInfo.chainId.toString()} rpc=${rpcUrls[rpcIndex]}`);
    console.log(`[dkeeper] wallet=${baseWallet.address}`);
    console.log(`[dkeeper] keeperNetwork=${keeperNetworkAddress}`);
    console.log(`[dkeeper] tradingCore=${tradingCoreAddress}`);
    console.log(`[dkeeper] oracleAggregator=${oracleAggregatorAddress} pyth=${pythAddress}`);
    console.log(
        `[dkeeper] orders=${enableOrders} triggers=${enableTriggers} liquidations=${enableLiquidations} concurrency=${maxConcurrency}`,
    );

    // --- Eligibility / optional staking -----------------------------------
    const permissionless = (await withRpcRetry(
        () => keeperNetwork.permissionlessMode(),
        "keeperNetwork.permissionlessMode",
    )) as boolean;
    console.log(`[dkeeper] permissionlessMode=${permissionless}`);

    let eligible = (await withRpcRetry(
        () => keeperNetwork.isEligible(baseWallet.address),
        "keeperNetwork.isEligible",
    )) as boolean;

    if (!eligible && !permissionless) {
        if (!autoStake) {
            throw new Error(
                `Wallet ${baseWallet.address} is not an eligible keeper and DK_AUTO_STAKE!=true. ` +
                    `Register/stake via KeeperNetwork.registerKeeper() or set DK_AUTO_STAKE=true with DK_STAKE_AMOUNT.`,
            );
        }
        const minStake = (await withRpcRetry(() => keeperNetwork.minStake(), "keeperNetwork.minStake")) as bigint;
        const stakeAmount = BigInt(process.env.DK_STAKE_AMOUNT ?? minStake.toString());
        if (stakeAmount < minStake) {
            throw new Error(`DK_STAKE_AMOUNT (${stakeAmount}) is below network minStake (${minStake}).`);
        }
        console.log(`[dkeeper] registering keeper with stake=${stakeAmount} wei ...`);
        const tx = await keeperNetwork.registerKeeper({ value: stakeAmount });
        await tx.wait();
        console.log(`[dkeeper] registered. tx=${tx.hash}`);
        eligible = true;
    }

    if (!eligible) {
        throw new Error(`Wallet ${baseWallet.address} is not eligible to execute through the KeeperNetwork.`);
    }
    console.log("[dkeeper] eligibility confirmed. entering main loop...");

    // --- Pyth helpers ------------------------------------------------------
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

    /** Fetch a combined Hermes update payload covering all given feed ids. */
    async function fetchHermesUpdateData(feedIds: string[]): Promise<string[]> {
        const ids = [...new Set(feedIds.map(bytes32ToPythId))].filter(Boolean);
        if (ids.length === 0) return [];
        const query = ids.map((id) => `ids[]=${id}`).join("&");
        const url = `${hermesBase}/v2/updates/price/latest?encoding=hex&${query}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Hermes ${res.status}: ${res.statusText}`);
        const body = (await res.json()) as { binary?: { data?: string[] } };
        return (body.binary?.data || []).filter(Boolean).map((d) => (d.startsWith("0x") ? d : `0x${d}`));
    }

    /** Build (updateData, fee) for the given markets; empty when no feeds. */
    async function buildPriceUpdate(markets: string[]): Promise<{ updateData: string[]; fee: bigint }> {
        const feeds: string[] = [];
        for (const m of markets) {
            const feedId = await getFeedIdForMarket(m);
            if (feedId) feeds.push(feedId);
        }
        if (feeds.length === 0) return { updateData: [], fee: 0n };
        const updateData = await fetchHermesUpdateData(feeds);
        if (updateData.length === 0) return { updateData: [], fee: 0n };
        const fee = (await withRpcRetry(() => pyth.getUpdateFee(updateData), "pyth.getUpdateFee")) as bigint;
        if (fee > maxUpdateFeeWei) {
            throw new Error(`Pyth update fee ${fee} exceeds DK_MAX_UPDATE_FEE_WEI ${maxUpdateFeeWei}`);
        }
        return { updateData, fee };
    }

    // --- State -------------------------------------------------------------
    let cursor = BigInt(Math.max(0, latest - Number(lookbackBlocks)));
    const pendingOrders = new Map<string, PendingOrder>();
    const openPositions = new Map<string, string>(); // positionId -> market
    const inFlight = new Set<string>();

    // --- Order execution ---------------------------------------------------
    async function processOrder(order: PendingOrder): Promise<void> {
        const key = order.id.toString();
        order.attempts += 1;
        try {
            const { updateData, fee } = await buildPriceUpdate([order.market]);
            const tx = await keeperNetwork.executeOrder(order.id, updateData, { value: fee });
            console.log(`[dkeeper] order execute sent id=${key} tx=${tx.hash}`);
            const receipt = await tx.wait();
            if (receipt?.status === 1) {
                pendingOrders.delete(key);
                console.log(`[dkeeper] order executed id=${key} block=${receipt.blockNumber}`);
                return;
            }
            console.warn(`[dkeeper] order tx reverted id=${key} (attempt ${order.attempts}/${maxOrderAttempts})`);
        } catch (err) {
            const selector = selectorFromError(err) ?? "n/a";
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
                `[dkeeper] order execute failed id=${key} selector=${selector} attempt=${order.attempts}/${maxOrderAttempts} msg=${message}`,
            );
            // Stale price is transient: a fresh Hermes pull on the next tick
            // usually clears it, so just leave it pending unless out of attempts.
        }
        if (order.attempts >= maxOrderAttempts) {
            pendingOrders.delete(key);
            console.warn(`[dkeeper] giving up order id=${key} after ${maxOrderAttempts} attempts`);
        }
    }

    // --- Liquidation -------------------------------------------------------
    async function tryLiquidate(positionId: string, market: string): Promise<boolean> {
        let liquidatable = false;
        try {
            const [can] = (await withRpcRetry(
                () => keeperNetwork.canLiquidate(positionId),
                "keeperNetwork.canLiquidate",
            )) as [boolean, bigint];
            liquidatable = can;
        } catch (e) {
            console.warn(`[dkeeper] canLiquidate failed id=${positionId} msg=${e instanceof Error ? e.message : e}`);
            return false;
        }
        if (!liquidatable) return false;

        try {
            const { updateData, fee } = await buildPriceUpdate([market]);
            const tx = await keeperNetwork.liquidate(positionId, updateData, { value: fee });
            console.log(`[dkeeper] liquidate sent id=${positionId} tx=${tx.hash}`);
            const receipt = await tx.wait();
            if (receipt?.status === 1) {
                openPositions.delete(positionId);
                console.log(`[dkeeper] liquidated id=${positionId} block=${receipt.blockNumber}`);
                return true;
            }
            console.warn(`[dkeeper] liquidate tx reverted id=${positionId} tx=${tx.hash}`);
        } catch (err) {
            const selector = selectorFromError(err) ?? "n/a";
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[dkeeper] liquidate failed id=${positionId} selector=${selector} msg=${message}`);
            if (selector === STALE_PRICE_SELECTOR) {
                console.warn(`[dkeeper] stale price on liquidate id=${positionId}; will retry next tick`);
            }
        }
        return false;
    }

    // --- Trigger batches (SL / TP / trailing) ------------------------------
    async function executeTriggerBatch(positionIds: string[], markets: string[]): Promise<void> {
        try {
            const { updateData, fee } = await buildPriceUpdate(markets);
            const tx = await keeperNetwork.executeTriggers(positionIds, updateData, { value: fee });
            console.log(`[dkeeper] triggers sent count=${positionIds.length} tx=${tx.hash}`);
            const receipt = await tx.wait();
            if (receipt?.status === 1) {
                console.log(`[dkeeper] triggers mined count=${positionIds.length} block=${receipt.blockNumber}`);
            } else {
                console.warn(`[dkeeper] triggers tx reverted count=${positionIds.length} tx=${tx.hash}`);
            }
        } catch (err) {
            const selector = selectorFromError(err) ?? "n/a";
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[dkeeper] triggers failed count=${positionIds.length} selector=${selector} msg=${message}`);
        }
    }

    /** Run `items` through `worker` with a bounded number of concurrent workers. */
    async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
        let idx = 0;
        const runNext = async (): Promise<void> => {
            while (idx < items.length) {
                await worker(items[idx++]);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
    }

    function positionHasTrigger(pos: any): boolean {
        return (
            (pos.stopLossPrice && pos.stopLossPrice !== 0n) ||
            (pos.takeProfitPrice && pos.takeProfitPrice !== 0n) ||
            (pos.trailingStopBps && Number(pos.trailingStopBps) > 0)
        );
    }

    // --- Event ingestion ---------------------------------------------------
    async function ingestLogs(from: bigint, to: bigint): Promise<void> {
        const topicsToFetch: Array<{ topic: string; tag: string }> = [];
        if (enableOrders) {
            topicsToFetch.push({ topic: createdTopic, tag: "created" });
            topicsToFetch.push({ topic: executedTopic, tag: "executed" });
            topicsToFetch.push({ topic: cancelledTopic, tag: "cancelled" });
        }
        if (enableTriggers || enableLiquidations) {
            topicsToFetch.push({ topic: openedTopic, tag: "opened" });
            topicsToFetch.push({ topic: closedTopic, tag: "closed" });
            topicsToFetch.push({ topic: liquidatedTopic, tag: "liquidated" });
        }

        const results = await Promise.all(
            topicsToFetch.map(({ topic, tag }) =>
                withRpcRetry(
                    () =>
                        provider.getLogs({
                            address: tradingCoreAddress,
                            fromBlock: from,
                            toBlock: to,
                            topics: [topic],
                        }),
                    `getLogs:${tag}`,
                ),
            ),
        );

        results.forEach((logs, i) => {
            const tag = topicsToFetch[i].tag;
            for (const log of logs) {
                const parsed = iface.parseLog(log);
                if (!parsed) continue;
                const args = parsed.args as any;
                if (tag === "created") {
                    const id = args.orderId as bigint;
                    pendingOrders.set(id.toString(), {
                        id,
                        market: (args.market as string) || ethers.ZeroAddress,
                        account: (args.account as string) || ethers.ZeroAddress,
                        attempts: 0,
                    });
                } else if (tag === "executed" || tag === "cancelled") {
                    pendingOrders.delete((args.orderId as bigint).toString());
                } else if (tag === "opened") {
                    openPositions.set(
                        (args.positionId as bigint).toString(),
                        (args.market as string) || ethers.ZeroAddress,
                    );
                } else if (tag === "closed" || tag === "liquidated") {
                    openPositions.delete((args.positionId as bigint).toString());
                }
            }
        });
    }

    // --- Main loop ---------------------------------------------------------
    while (true) {
        try {
            let currentBlock: bigint;
            try {
                currentBlock = BigInt(await withRpcRetry(() => provider.getBlockNumber(), "loop:getBlockNumber"));
            } catch (rpcErr) {
                if (await backoffMainLoop(rpcPause, rpcErr, "dkeeper", rpcRetryBaseDelayMs, "loop:getBlockNumber")) {
                    continue;
                }
                throw rpcErr;
            }
            if (currentBlock > cursor) {
                let from = cursor + 1n;
                while (from <= currentBlock) {
                    const to = from + blockChunkSize > currentBlock ? currentBlock : from + blockChunkSize;
                    await ingestLogs(from, to);
                    from = to + 1n;
                }
                cursor = currentBlock;
            }

            // 1) Orders — execute concurrently (oldest first).
            if (enableOrders && pendingOrders.size > 0) {
                const orders = [...pendingOrders.values()]
                    .filter((o) => !inFlight.has(o.id.toString()))
                    .sort((a, b) => (a.id < b.id ? -1 : 1));
                if (orders.length > 0) {
                    console.log(`[dkeeper] orders pending=${pendingOrders.size} dispatching=${orders.length}`);
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

            // 2) Positions — confirm open, liquidate underwater ones, batch triggers.
            if ((enableTriggers || enableLiquidations) && openPositions.size > 0) {
                const triggerCandidates: string[] = [];
                const triggerMarkets: string[] = [];

                for (const [positionId, knownMarket] of [...openPositions.entries()]) {
                    try {
                        const pos = await withRpcRetry(
                            () => tradingCore.getPosition(positionId),
                            "tradingCore.getPosition",
                        );
                        if (Number(pos.state) !== POS_STATUS_OPEN) {
                            openPositions.delete(positionId);
                            continue;
                        }
                        const market = (pos.market as string) || knownMarket;

                        if (enableLiquidations) {
                            const liquidated = await tryLiquidate(positionId, market);
                            if (liquidated) continue; // position gone; skip trigger batch
                        }
                        if (enableTriggers && positionHasTrigger(pos)) {
                            triggerCandidates.push(positionId);
                            triggerMarkets.push(market);
                        }
                    } catch (e) {
                        console.warn(
                            `[dkeeper] position check failed id=${positionId} msg=${e instanceof Error ? e.message : e}`,
                        );
                    }
                }

                // Submit trigger candidates in bounded batches; the core decides
                // which actually meet their stop-loss / take-profit / trailing
                // condition at the current oracle snapshot.
                for (let i = 0; i < triggerCandidates.length; i += triggerBatchSize) {
                    const ids = triggerCandidates.slice(i, i + triggerBatchSize);
                    const markets = triggerMarkets.slice(i, i + triggerBatchSize);
                    await executeTriggerBatch(ids, markets);
                }
            }
        } catch (err) {
            if (await backoffMainLoop(rpcPause, err, "dkeeper", rpcRetryBaseDelayMs)) {
                continue;
            }
            console.error(`[dkeeper] loop error: ${err instanceof Error ? err.message : String(err)}`);
        }

        const hasWork = pendingOrders.size > 0 || openPositions.size > 0;
        await sleepMs(hasWork ? pollMs : idlePollMs);
    }
}

main().catch((err) => {
    console.error("[dkeeper] fatal:", err);
    process.exit(1);
});
