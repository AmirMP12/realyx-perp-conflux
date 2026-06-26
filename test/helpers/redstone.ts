import { ethers } from "hardhat";
import type { Signer } from "ethers";
import { DataPackage, NumericDataPoint, RedstonePayload } from "@redstone-finance/protocol";

/**
 * Helpers for driving the RedStone-backed adapter in tests.
 *
 * RedStone's pull model reads a SIGNED price payload appended to the END of the
 * transaction calldata. `RedStoneAdapterHarness` authorises the well-known
 * RedStone MOCK signer set (the default Hardhat accounts), so we can sign a
 * data package locally with Hardhat account #0 and append it ourselves.
 *
 * Account #0 (0xf39Fd6e5...92266) maps to mock signer index 0 in
 * `AuthorisedMockSignersBase`, and the harness requires only ONE unique signer.
 */

// Hardhat default account #0 private key — an authorised RedStone mock signer.
const MOCK_SIGNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Default decimals RedStone numeric feeds use; matches `feedDecimals = 8` in setFeed.
export const REDSTONE_DECIMALS = 8;

export interface FeedPoint {
    /** Feed id string, e.g. "BTC" or "TSLA". */
    dataFeedId: string;
    /** Human value, e.g. 50000 for $50k. */
    value: number;
    /** Optional override of the feed decimals (defaults to 8). */
    decimals?: number;
}

/**
 * Build a RedStone payload (hex, NO 0x prefix) carrying one or more numeric
 * data points, signed by the mock signer. Append this to a tx's calldata.
 */
export function buildRedstonePayload(points: FeedPoint[], timestampMs?: number): string {
    const ts = timestampMs ?? Date.now();
    const dataPoints = points.map(
        (p) =>
            new NumericDataPoint({
                dataFeedId: p.dataFeedId,
                value: p.value,
                decimals: p.decimals ?? REDSTONE_DECIMALS,
            }),
    );
    const pkg = new DataPackage(dataPoints, ts, "REDSTONE");
    const signed = pkg.sign(MOCK_SIGNER_PK);
    const payloadHex = RedstonePayload.prepare([signed], "");
    return payloadHex.startsWith("0x") ? payloadHex.slice(2) : payloadHex;
}

/** bytes32 feed id from a feed string, as expected by `RedStoneAdapter.setFeed`. */
export function feedId(symbol: string): string {
    return ethers.encodeBytes32String(symbol);
}

/**
 * Push a single market's price into the adapter by appending a signed RedStone
 * payload to the `pushPrice` calldata. `keeper` must hold REDSTONE_KEEPER_ROLE.
 */
export async function pushRedstonePrice(
    adapter: any,
    keeper: Signer,
    market: string,
    points: FeedPoint[],
    timestampMs?: number,
): Promise<void> {
    const payload = buildRedstonePayload(points, timestampMs);
    const fnData = adapter.interface.encodeFunctionData("pushPrice", [market]);
    const tx = await keeper.sendTransaction({
        to: await adapter.getAddress(),
        data: fnData + payload,
    });
    await tx.wait();
}

/** Batch variant: push several markets that share one signed payload. */
export async function pushRedstonePrices(
    adapter: any,
    keeper: Signer,
    markets: string[],
    points: FeedPoint[],
    timestampMs?: number,
): Promise<void> {
    const payload = buildRedstonePayload(points, timestampMs);
    const fnData = adapter.interface.encodeFunctionData("pushPrices", [markets]);
    const tx = await keeper.sendTransaction({
        to: await adapter.getAddress(),
        data: fnData + payload,
    });
    await tx.wait();
}
