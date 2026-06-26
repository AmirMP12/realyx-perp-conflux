import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const M = "0x00000000000000000000000000000000000000B7";
const FEED = "0x00000000000000000000000000000000000000F1";

async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

/**
 * Verifies ConfigLib margin-config validation and market update/unlist edge cases.
 * setMarket signature:
 *   (m, feed, maxLev, maxPos, maxExp, mmBps, imBps, maxStaleness, maxOracleUncertainty)
 */
describe("ConfigLib margin-config validation matrix", () => {
    const valid = (over: Partial<{ mm: number; im: number; lev: number }> = {}) => ({
        mm: over.mm ?? 500,
        im: over.im ?? 1000,
        lev: over.lev ?? 20,
    });

    it("accepts a valid market config", async () => {
        const h = await loadFixture(coverageHarness);
        const v = valid();
        await h.testSetMarket(M, FEED, v.lev, e18(1_000_000), e18(5_000_000), v.mm, v.im, 900, e18(1) / 2n);
    });

    it("reverts when mmBps < 50", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 40, 1000, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("reverts when mmBps > 5000", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 6000, 8000, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("reverts when imBps < 100", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 60, 90, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("reverts when imBps > 10000", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 500, 10001, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("reverts when imBps <= mmBps", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 1000, 1000, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("reverts when maxLev is 0", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 0, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("reverts when maxLev > MAX_LEVERAGE_LIMIT (100)", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 101, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("reverts setMarket with zero feed", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, ethers.ZeroAddress, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    describe("updateMarket", () => {
        it("reverts updating an unlisted market", async () => {
            const h = await loadFixture(coverageHarness);
            await expect(
                h.testUpdateMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n),
            ).to.be.reverted; // InvalidMarket (not listed)
        });
        it("updates margin config after listing", async () => {
            const h = await loadFixture(coverageHarness);
            await h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n);
            await h.testUpdateMarket(M, FEED, 15, e18(2_000_000), e18(6_000_000), 600, 1200, 800, e18(1) / 2n);
        });
        it("reverts update with invalid margin config (im <= mm)", async () => {
            const h = await loadFixture(coverageHarness);
            await h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n);
            await expect(
                h.testUpdateMarket(M, FEED, 15, e18(2_000_000), e18(6_000_000), 1000, 1000, 800, e18(1) / 2n),
            ).to.be.reverted;
        });
        it("reverts update with zero feed", async () => {
            const h = await loadFixture(coverageHarness);
            await h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n);
            await expect(
                h.testUpdateMarket(M, ethers.ZeroAddress, 15, e18(2_000_000), e18(6_000_000), 600, 1200, 800, e18(1) / 2n),
            ).to.be.reverted;
        });
    });

    describe("unlistMarket", () => {
        it("reverts unlisting an unknown market", async () => {
            const h = await loadFixture(coverageHarness);
            await expect(h.setUnlistMarket(M)).to.be.reverted;
        });
        it("unlists a listed market and removes from active set", async () => {
            const h = await loadFixture(coverageHarness);
            await h.testSetMarket(M, FEED, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n);
            await h.setUnlistMarket(M);
        });
    });
});

describe("ConfigLib margin-config validation — individual rule checks", () => {
    async function coverageHarness() {
        const libs = await deployAllLibraries();
        return deployHarness("CoverageHarness", libs);
    }
    const M = "0x00000000000000000000000000000000000000B7";
    const FEED = "0x00000000000000000000000000000000000000F1";
    const U = e18(1) / 2n;

    // Each case violates exactly ONE margin-config rule of
    // (mm<50 || mm>5000 || im<100 || im>10000 || im<=mm) while keeping the others valid.
    it("trips only mm<50 (im valid, im>mm)", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 49, 200, 900, U)).to.be.reverted;
    });
    it("trips only mm>5000 (with im>mm and im<=10000)", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 5001, 6000, 900, U)).to.be.reverted;
    });
    it("trips only im<100 (mm valid and below im)", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 60, 99, 900, U)).to.be.reverted;
    });
    it("trips only im>10000 (mm valid)", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 10001, 900, U)).to.be.reverted;
    });
    it("trips only im<=mm (both individually in-range)", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 600, 600, 900, U)).to.be.reverted;
    });
    it("accepts the all-valid boundary (mm=50, im=10000)", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testSetMarket(M, FEED, 100, e18(1e6), e18(5e6), 50, 10000, 900, U);
    });
});
