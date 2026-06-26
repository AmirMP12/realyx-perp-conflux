import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const FEED = "0x00000000000000000000000000000000000000F1";
const U = e18(1) / 2n;

/**
 * Verifies ConfigLib market configuration via the harness wrappers, covering:
 *   - setMarket skipping the active-set push when a market is already active
 *   - setMarket enforcing the MAX_ACTIVE_MARKETS cap
 *   - setMarket skipping funding-clock init when lastSettlement is already set
 *   - updateMarket validation of feed, leverage, and margin config
 *   - unlistMarket removing a market from the active set
 */
async function harness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

// distinct 20-byte addresses for filling the active-market set
const addr = (i: number) => ethers.getAddress("0x" + (i + 0x100).toString(16).padStart(40, "0"));

describe("ConfigLib — setMarket", () => {
    it("setMarket skips the active-push when the market is already active", async () => {
        const h = await loadFixture(harness);
        const M = addr(1);
        // mark active BEFORE listing -> setMarket sees isMarketActive[m]==true,
        // so it skips the active-set push and the cap check
        await h.corruptIsMarketActive(M, true);
        await h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
        // listed successfully without reverting on the cap
        await expect(h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U)).to.be.reverted; // MarketAlreadyListed
    });

    it("setMarket reverts MaxActiveMarketsExceeded when the active set is full", async () => {
        const h = await loadFixture(harness);
        // fill exactly MAX_ACTIVE_MARKETS (20) active slots
        for (let i = 0; i < 20; i++) {
            await h.testSetMarket(addr(i), FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
        }
        // the 21st distinct market trips the cap
        await expect(
            h.testSetMarket(addr(99), FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U),
        ).to.be.reverted;
    });

    it("setMarket skips funding-clock init when lastSettlement already set", async () => {
        const h = await loadFixture(harness);
        const M = addr(2);
        // preset the funding clock so the `== 0` guard is false
        await h.setHarnessFundingLastSettlement(M, 12345);
        await h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
        expect((await h.configMarkets(M)).isListed).to.equal(true);
    });

    it("setMarket accepts a valid market", async () => {
        const h = await loadFixture(harness);
        const M = addr(3);
        await h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
        expect((await h.configMarkets(M)).isListed).to.equal(true);
    });
});

describe("ConfigLib — updateMarket", () => {
    async function listed() {
        const h = await loadFixture(harness);
        const M = addr(4);
        await h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
        return { h, M };
    }

    it("updateMarket reverts on zero feed", async () => {
        const { h, M } = await listed();
        await expect(
            h.testUpdateMarket(M, ethers.ZeroAddress, 20, e18(1e6), e18(5e6), 500, 1000, 900, U),
        ).to.be.reverted;
    });

    it("updateMarket reverts for an unlisted market", async () => {
        const h = await loadFixture(harness);
        const M = addr(5); // never listed
        await expect(
            h.testUpdateMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U),
        ).to.be.reverted;
    });

    it("updateMarket reverts when maxLev == 0", async () => {
        const { h, M } = await listed();
        await expect(
            h.testUpdateMarket(M, FEED, 0, e18(1e6), e18(5e6), 500, 1000, 900, U),
        ).to.be.reverted;
    });

    it("updateMarket reverts when maxLev > MAX_LEVERAGE_LIMIT", async () => {
        const { h, M } = await listed();
        await expect(
            h.testUpdateMarket(M, FEED, 101, e18(1e6), e18(5e6), 500, 1000, 900, U),
        ).to.be.reverted;
    });

    it("updateMarket reverts on invalid margin config im <= mm", async () => {
        const { h, M } = await listed();
        await expect(
            h.testUpdateMarket(M, FEED, 20, e18(1e6), e18(5e6), 600, 600, 900, U),
        ).to.be.reverted;
    });

    it("updateMarket succeeds with valid params", async () => {
        const { h, M } = await listed();
        await h.testUpdateMarket(M, FEED, 15, e18(2e6), e18(6e6), 600, 1200, 800, U);
        const m = await h.configMarkets(M);
        expect(m.maxLeverage).to.equal(15n);
        expect(m.initialMargin).to.equal(1200n);
    });
});

describe("ConfigLib — unlistMarket loop", () => {
    it("unlists an active market, removing it from the active set", async () => {
        const h = await loadFixture(harness);
        const M = addr(6);
        await h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
        await h.setUnlistMarket(M);
        expect((await h.configMarkets(M)).isListed).to.equal(false);
    });
});
