import { ethers } from "hardhat";
import { requireEnv } from "./helpers";

const MIN_GAS_GWEI = 2;
const RETRY_DELAY_MS = 4000;
const MAX_UNDERPRICED_ATTEMPTS = 8;
type GasOverrides = { gasPrice: bigint };

function isUnderpriced(e: unknown): boolean {
    const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "";
    return msg.includes("replacement transaction underpriced");
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getGasOverrides(): Promise<GasOverrides | undefined> {
    const provider = ethers.provider;
    const network = await provider.getNetwork();
    if (network.chainId === 31337n) return undefined;

    const envGwei = process.env.GAS_PRICE_GWEI?.trim();
    let gasPrice: bigint;
    if (envGwei) {
        gasPrice = BigInt(Math.floor(parseFloat(envGwei) * 1e9));
        if (gasPrice <= 0n) return undefined;
    } else {
        const minWei = BigInt(Math.ceil(MIN_GAS_GWEI * 1e9));
        try {
            const fee = await provider.getFeeData();
            const raw = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
            const bumped = raw > 0n ? (raw * 150n) / 100n : minWei;
            gasPrice = bumped > minWei ? bumped : minWei;
        } catch {
            gasPrice = minWei;
        }
    }
    console.log("Gas price:", Number(gasPrice) / 1e9, "gwei");
    return { gasPrice };
}

async function getBumpedGasOverrides(current: GasOverrides | undefined): Promise<GasOverrides> {
    const provider = ethers.provider;
    const minWei = BigInt(Math.ceil(MIN_GAS_GWEI * 1e9));
    let next: bigint;
    try {
        const fee = await provider.getFeeData();
        const raw = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
        next = raw > 0n ? (raw * 130n) / 100n : minWei;
    } catch {
        next = minWei;
    }
    if (current?.gasPrice && current.gasPrice > next) next = (current.gasPrice * 120n) / 100n;
    if (next < minWei) next = minWei;
    return { gasPrice: next };
}

function formatRevertReason(e: unknown): string {
    const err = e as Error & { data?: string; error?: { data?: string }; info?: { error?: { data?: string } } };
    const msg = err?.message ?? String(e);
    let reason = msg;
    const data = err?.data ?? err?.error?.data ?? err?.info?.error?.data;
    if (data && typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
        const sig = data.slice(0, 10);
        const known: Record<string, string> = {
            "0x4d5eeb49": "MarketAlreadyListed()",
            "0x770241a0": "MaxActiveMarketsExceeded()",
            "0xed39399c": "InvalidMarginConfig()",
            "0x9db8d5b1": "InvalidMarket()",
            "0x6979bd5a": "ExceedsMaxLeverage()",
        };
        reason = known[sig] ?? `revert (selector ${sig})`;
    }
    return reason;
}

async function withRetryUnderpriced<T>(
    overrides: GasOverrides | undefined,
    fn: (o: GasOverrides | undefined) => Promise<T>,
    label?: string,
): Promise<T> {
    let current = overrides ? { ...overrides } : undefined;
    for (let attempt = 0; attempt < MAX_UNDERPRICED_ATTEMPTS; attempt++) {
        try {
            return await fn(current);
        } catch (e) {
            if (attempt < MAX_UNDERPRICED_ATTEMPTS - 1 && isUnderpriced(e)) {
                current = await getBumpedGasOverrides(current);
                console.log(
                    "Retrying (replacement transaction underpriced) with gas",
                    Number(current.gasPrice) / 1e9,
                    "gwei" + (label ? `: ${label}` : ""),
                );
                await delay(RETRY_DELAY_MS);
            } else throw e;
        }
    }
    throw new Error("unreachable");
}

function getMarketsFromEnv(): { marketAddress: string; pythFeedId: string; marketId: string }[] {
    const multiAddrs = process.env.MARKET_ADDRESSES?.trim();
    const multiFeeds = process.env.PYTH_FEED_IDS?.trim();
    if (multiAddrs && multiFeeds) {
        const addrs = multiAddrs
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const feeds = multiFeeds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (addrs.length !== feeds.length) {
            throw new Error(
                `MARKET_ADDRESSES (${addrs.length}) and PYTH_FEED_IDS (${feeds.length}) must have the same number of entries`,
            );
        }
        const marketIds = (process.env.MARKET_IDS || "").split(",").map((s) => s.trim());
        return addrs.map((marketAddress, i) => ({
            marketAddress,
            pythFeedId: feeds[i]!,
            marketId: marketIds[i] ?? "",
        }));
    }
    const marketAddress = process.env.MARKET_ADDRESS?.trim();
    const pythFeedId = process.env.PYTH_FEED_ID?.trim();
    if (marketAddress && pythFeedId) {
        return [{ marketAddress, pythFeedId, marketId: process.env.MARKET_ID || "" }];
    }
    throw new Error(
        "Set either MARKET_ADDRESS + PYTH_FEED_ID (single) or MARKET_ADDRESSES + PYTH_FEED_IDS (comma-separated)",
    );
}

async function main() {
    const oracleAddr = requireEnv("DEPLOYED_ORACLE_AGGREGATOR");
    const tradingCoreAddr = requireEnv("DEPLOYED_TRADING_CORE");
    const markets = getMarketsFromEnv();

    const maxLeverage = BigInt(process.env.MAX_LEVERAGE || "10");
    const maxPositionSize = BigInt(process.env.MAX_POSITION_SIZE || "100000000000000000000000");
    const maxExposure = BigInt(process.env.MAX_EXPOSURE || "50000000000000000000000000");
    const mmBps = Number(process.env.MAINTENANCE_MARGIN_BPS || "500");
    const imBps = Number(process.env.INITIAL_MARGIN_BPS || "1000");
    const maxStaleness = Number(process.env.MAX_STALENESS || "900");

    const overrides = await getGasOverrides();

    const oracle = await ethers.getContractAt("OracleAggregator", oracleAddr);
    const tradingCore = await ethers.getContractAt("TradingCore", tradingCoreAddr);

    const MAX_ACTIVE_MARKETS = 20n;
    const activeCount = await tradingCore.activeMarketCount();
    console.log("TradingCore active markets:", activeCount.toString(), "/", MAX_ACTIVE_MARKETS.toString());

    for (let i = 0; i < markets.length; i++) {
        const { marketAddress, pythFeedId, marketId } = markets[i]!;
        console.log(`\n--- Market ${i + 1}/${markets.length}: ${marketAddress} ${marketId || ""} ---`);

        const hex = pythFeedId.startsWith("0x") ? pythFeedId : "0x" + pythFeedId;
        const feedIdBytes32 = ethers.hexlify(ethers.zeroPadValue(ethers.getBytes(hex), 32));

        try {
            await withRetryUnderpriced(overrides, (o) =>
                oracle.setPythFeed(marketAddress, feedIdBytes32, maxStaleness, 0, o ?? {}),
            );
            console.log("OracleAggregator.setPythFeed ok");

            await withRetryUnderpriced(
                overrides,
                (o) => oracle.addSupportedMarket(marketAddress, o ?? {}),
                "addSupportedMarket",
            );
            console.log("OracleAggregator.addSupportedMarket ok");

            if (marketId) {
                await withRetryUnderpriced(overrides, (o) => oracle.setMarketId(marketAddress, marketId, o ?? {}));
                console.log("OracleAggregator.setMarketId ok");
            }

            const existingMarket = await tradingCore.getMarketInfo(marketAddress);
            const currentCount = await tradingCore.activeMarketCount();

            if (existingMarket.isListed) {
                await withRetryUnderpriced(
                    overrides,
                    (o) =>
                        tradingCore.updateMarket(
                            marketAddress,
                            marketAddress,
                            maxLeverage,
                            maxPositionSize,
                            maxExposure,
                            mmBps,
                            imBps,
                            maxStaleness,
                            o ?? {},
                        ),
                    "updateMarket",
                );
                console.log("TradingCore.updateMarket ok (market already listed)");
            } else {
                if (currentCount >= MAX_ACTIVE_MARKETS) {
                    throw new Error(
                        `TradingCore has ${currentCount} active markets; max is ${MAX_ACTIVE_MARKETS}. ` +
                            "Cannot add more markets. Unlist a market first or upgrade the contract to increase MAX_ACTIVE_MARKETS.",
                    );
                }
                await withRetryUnderpriced(
                    overrides,
                    (o) =>
                        tradingCore.setMarket(
                            marketAddress,
                            marketAddress,
                            maxLeverage,
                            maxPositionSize,
                            maxExposure,
                            mmBps,
                            imBps,
                            maxStaleness,
                            o ?? {},
                        ),
                    "setMarket",
                );
                console.log("TradingCore.setMarket ok");
            }

            if (marketId) {
                await withRetryUnderpriced(overrides, (o) => tradingCore.setMarketId(marketAddress, marketId, o ?? {}));
                console.log("TradingCore.setMarketId ok");
            }
        } catch (e) {
            const reason = formatRevertReason(e);
            console.error("\nExecution reverted for market", marketAddress, marketId || "", ":", reason);
            if (reason.includes("revert") || reason.includes("reverted")) {
                console.error(
                    "Common causes: MaxActiveMarketsExceeded (max 20 markets), MarketAlreadyListed, InvalidMarginConfig, or missing OPERATOR role.",
                );
            }
            throw e;
        }
    }

    console.log(
        "\nMarket setup complete for",
        markets.length,
        "market(s):",
        markets.map((m) => m.marketAddress).join(", "),
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
