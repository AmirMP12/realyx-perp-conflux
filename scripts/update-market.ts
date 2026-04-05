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

async function withRetryUnderpriced<T>(
    overrides: GasOverrides | undefined,
    fn: (o: GasOverrides | undefined) => Promise<T>,
    label?: string
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
                    "gwei" + (label ? `: ${label}` : "")
                );
                await delay(RETRY_DELAY_MS);
            } else throw e;
        }
    }
    throw new Error("unreachable");
}

/**
 * Update an existing listed market on OracleAggregator and TradingCore.
 * Uses current on-chain values; override only the env vars you want to change.
 *
 * Required: DEPLOYED_ORACLE_AGGREGATOR, DEPLOYED_TRADING_CORE, MARKET_ADDRESS
 * Optional: PYTH_FEED_ID, MARKET_ID, MAX_LEVERAGE, MAX_POSITION_SIZE, MAX_EXPOSURE,
 *           MAINTENANCE_MARGIN_BPS, INITIAL_MARGIN_BPS, MAX_STALENESS
 */
async function main() {
    const oracleAddr = requireEnv("DEPLOYED_ORACLE_AGGREGATOR");
    const tradingCoreAddr = requireEnv("DEPLOYED_TRADING_CORE");
    const marketAddress = (process.env.MARKET_ADDRESS ?? process.env.UPDATE_MARKET_ADDRESS)?.trim();
    if (!marketAddress || !ethers.isAddress(marketAddress)) {
        throw new Error("Set MARKET_ADDRESS or UPDATE_MARKET_ADDRESS to the market to update.");
    }

    const tradingCore = await ethers.getContractAt("TradingCore", tradingCoreAddr);
    const existing = await tradingCore.getMarketInfo(marketAddress);
    if (!existing.isListed) {
        throw new Error(`Market ${marketAddress} is not listed. Use setup-market.ts to add it first.`);
    }

    const overrides = await getGasOverrides();
    const oracle = await ethers.getContractAt("OracleAggregator", oracleAddr);

    const maxLeverage = process.env.MAX_LEVERAGE?.trim()
        ? BigInt(process.env.MAX_LEVERAGE)
        : existing.maxLeverage;
    const maxPositionSize = process.env.MAX_POSITION_SIZE?.trim()
        ? BigInt(process.env.MAX_POSITION_SIZE)
        : existing.maxPositionSize;
    const maxExposure = process.env.MAX_EXPOSURE?.trim()
        ? BigInt(process.env.MAX_EXPOSURE)
        : existing.maxTotalExposure;
    const mmBps = process.env.MAINTENANCE_MARGIN_BPS?.trim()
        ? Number(process.env.MAINTENANCE_MARGIN_BPS)
        : Number(existing.maintenanceMargin);
    const imBps = process.env.INITIAL_MARGIN_BPS?.trim()
        ? Number(process.env.INITIAL_MARGIN_BPS)
        : Number(existing.initialMargin);
    const maxStaleness = process.env.MAX_STALENESS?.trim()
        ? Number(process.env.MAX_STALENESS)
        : Number(existing.maxStaleness);

    const feed = existing.chainlinkFeed && existing.chainlinkFeed !== ethers.ZeroAddress
        ? existing.chainlinkFeed
        : marketAddress;

    console.log("Updating market:", marketAddress);
    console.log("  maxLeverage:", maxLeverage.toString(), "maxPositionSize:", maxPositionSize.toString(), "maxExposure:", maxExposure.toString());
    console.log("  mmBps:", mmBps, "imBps:", imBps, "maxStaleness:", maxStaleness);

    if (process.env.PYTH_FEED_ID?.trim()) {
        const hex = process.env.PYTH_FEED_ID.trim().startsWith("0x")
            ? process.env.PYTH_FEED_ID.trim()
            : "0x" + process.env.PYTH_FEED_ID.trim();
        const feedIdBytes32 = ethers.hexlify(ethers.zeroPadValue(ethers.getBytes(hex), 32));
        await withRetryUnderpriced(overrides, (o) =>
            oracle.setPythFeed(marketAddress, feedIdBytes32, maxStaleness, 0, o ?? {})
        );
        console.log("OracleAggregator.setPythFeed ok");
    }

    await withRetryUnderpriced(overrides, (o) =>
        tradingCore.updateMarket(
            marketAddress,
            feed,
            maxLeverage,
            maxPositionSize,
            maxExposure,
            mmBps,
            imBps,
            maxStaleness,
            o ?? {}
        ),
        "updateMarket"
    );
    console.log("TradingCore.updateMarket ok");

    const marketId = process.env.MARKET_ID?.trim();
    if (marketId) {
        await withRetryUnderpriced(overrides, (o) => oracle.setMarketId(marketAddress, marketId, o ?? {}));
        console.log("OracleAggregator.setMarketId ok");
        await withRetryUnderpriced(overrides, (o) => tradingCore.setMarketId(marketAddress, marketId, o ?? {}));
        console.log("TradingCore.setMarketId ok");
    }

    console.log("\nMarket update complete for", marketAddress);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
