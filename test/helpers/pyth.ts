import { ethers } from "hardhat";
import type { MockPythWrapper } from "../../typechain";

/**
 * Helpers for driving the MockPyth oracle in tests.
 *
 * Pyth feeds report a signed `price` with an `expo`. The OracleAggregator
 * normalizes to 1e18 via `_normalizePythPrice`: normalized = price * 10**(18+expo).
 * We default to expo = -8 (the production-typical value), so to produce a
 * normalized price `P` (1e18 scaled) the raw price is `P / 10**10`.
 */

export const PYTH_EXPO = -8;

/**
 * Convert a human price (e.g. 50000 for $50k) into the raw int64 Pyth price
 * for the default expo (-8). 50000 -> 50000 * 1e8.
 */
export function toPythPrice(humanPrice: number | bigint): bigint {
    const scale = 10n ** BigInt(-PYTH_EXPO);
    if (typeof humanPrice === "bigint") return humanPrice * scale;
    // support decimals
    return BigInt(Math.round(humanPrice * Number(scale)));
}

/**
 * Given a desired normalized (1e18) price, compute the raw Pyth int64 price
 * for the default expo so OracleAggregator normalizes back to `normalized`.
 */
export function rawFromNormalized(normalized1e18: bigint): bigint {
    // normalized = raw * 10**(18 + expo) = raw * 10**10  (expo=-8)
    const factor = 10n ** BigInt(18 + PYTH_EXPO);
    return normalized1e18 / factor;
}

/**
 * Build a single Pyth price-update blob for the MockPyth contract.
 * @param mockPyth deployed MockPythWrapper
 * @param feedId bytes32 feed id
 * @param normalized1e18 desired normalized price (1e18 scale)
 * @param confNormalized1e18 desired normalized confidence (1e18 scale).
 *        Defaults to a small fixed band (1e14) — note the OracleAggregator
 *        stores `maxConfidence` as uint64, so a confidence proportional to a
 *        large 1e18 price would overflow it. A small absolute band keeps reads
 *        well within both `maxConfidence` and `maxOracleUncertainty`.
 * @param publishTime optional publish time (defaults to current block time)
 */
export const DEFAULT_CONF = 10n ** 14n;

export async function buildPriceUpdate(
    mockPyth: MockPythWrapper,
    feedId: string,
    normalized1e18: bigint,
    confNormalized1e18?: bigint,
    publishTime?: number,
): Promise<string> {
    const rawPrice = rawFromNormalized(normalized1e18);
    // confidence normalizes the same way as price
    const conf = confNormalized1e18 === undefined ? DEFAULT_CONF : confNormalized1e18;
    const rawConf = rawFromNormalized(conf);
    const t = publishTime ?? (await currentTime());
    return mockPyth.createPriceFeedUpdateData(
        feedId,
        rawPrice,
        rawConf < 0n ? 0n : rawConf,
        PYTH_EXPO,
        rawPrice, // emaPrice
        rawConf < 0n ? 0n : rawConf, // emaConf
        t,
        0, // prevPublishTime
    );
}

/**
 * Push a price into MockPyth so subsequent getPriceUnsafe returns it.
 */
export async function setPythPrice(
    mockPyth: MockPythWrapper,
    feedId: string,
    normalized1e18: bigint,
    confNormalized1e18?: bigint,
    publishTime?: number,
): Promise<void> {
    const data = await buildPriceUpdate(mockPyth, feedId, normalized1e18, confNormalized1e18, publishTime);
    const fee = await mockPyth.getUpdateFee([data]);
    await mockPyth.updatePriceFeeds([data], { value: fee });
}

export async function currentTime(): Promise<number> {
    const block = await ethers.provider.getBlock("latest");
    return block!.timestamp;
}
