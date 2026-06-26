import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

/**
 * Verifies OracleAggregatorLib TWAP and aggregation logic via the harness
 * wrappers, covering:
 *   - calculateTWAP reverting when count == 0
 *   - the cutoff-time window edge where the window meets or exceeds the timestamp
 *   - calculateTWAP reverting when no points contribute weight
 *   - calculateTWAPWithCount reverting when count == 0
 *   - calculateTWAPWithCount's cutoff-time window edge
 *   - calculateTWAPWithCount reverting when no points contribute weight
 *   - computeAggregatedPrice returning zeros for empty inputs
 *
 * Note: the `price > maxSafePrice` guards are unreachable because `point.price`
 * is a uint128 and `maxSafePrice` is type(uint128).max, so the stored value can
 * never exceed it. The overflow guards (`weightedSum + contribution < weightedSum`)
 * require an arithmetic overflow that the 48-slot ring buffer cannot accumulate,
 * so those revert paths are defensive code left untested.
 */
async function harness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

async function now(): Promise<number> {
    return (await ethers.provider.getBlock("latest"))!.timestamp;
}

describe("OracleAggregatorLib — TWAP and aggregation", () => {
    it("calculateTWAP reverts when count == 0", async () => {
        const h = await loadFixture(harness);
        // no price points added -> count stays 0
        await expect(h.testCalculateTWAP(900)).to.be.reverted;
    });

    it("calculateTWAP uses a zero cutoff when the window meets or exceeds the timestamp", async () => {
        const h = await loadFixture(harness);
        const t = await now();
        await h.addPricePoint(e18(100), 0, t);
        // windowSeconds larger than the current block timestamp -> cutoffTime = 0
        const twap = await h.testCalculateTWAP.staticCall(t * 2);
        expect(twap).to.be.greaterThan(0n);
    });

    it("calculateTWAP reverts NoValidPrice when all points fall before cutoff", async () => {
        const h = await loadFixture(harness);
        // ancient point + small window -> point.timestamp < cutoffTime -> loop breaks,
        // totalWeight stays 0 -> revert
        await h.addPricePoint(e18(100), 0, 1000);
        await expect(h.testCalculateTWAP(10)).to.be.reverted;
    });

    it("calculateTWAPWithCount reverts when count == 0", async () => {
        const h = await loadFixture(harness);
        await expect(h.testCalculateTWAPWithCount(900)).to.be.reverted;
    });

    it("calculateTWAPWithCount uses a zero cutoff when the window meets or exceeds the timestamp", async () => {
        const h = await loadFixture(harness);
        const t = await now();
        await h.addPricePoint(e18(100), 0, t);
        const [twap, points] = await h.testCalculateTWAPWithCount.staticCall(t * 2);
        expect(twap).to.be.greaterThan(0n);
        expect(points).to.equal(1n);
    });

    it("calculateTWAPWithCount reverts NoValidPrice when all points fall before cutoff", async () => {
        const h = await loadFixture(harness);
        await h.addPricePoint(e18(100), 0, 1000);
        await expect(h.testCalculateTWAPWithCount(10)).to.be.reverted;
    });

    it("computeAggregatedPrice returns zeros for empty inputs", async () => {
        const h = await loadFixture(harness);
        const [agg, validCount, totalWeight] = await h.testComputeAggregatedPrice.staticCall([], [], 500);
        expect(agg).to.equal(0n);
        expect(validCount).to.equal(0n);
        expect(totalWeight).to.equal(0n);
    });

    it("calculateTWAP aggregates multiple valid points within the window (happy path)", async () => {
        const h = await loadFixture(harness);
        const t = await now();
        await h.addPricePoint(e18(100), 0, t - 30);
        await h.addPricePoint(e18(110), 0, t - 20);
        await h.addPricePoint(e18(120), 0, t - 10);
        const twap = await h.testCalculateTWAP.staticCall(3600);
        expect(twap).to.be.greaterThan(0n);
    });
});
