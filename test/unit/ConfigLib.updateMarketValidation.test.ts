import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const FEED = "0x00000000000000000000000000000000000000F1";
const U = e18(1) / 2n;
const CONFIGLIB_KEY = "contracts/libraries/ConfigLib.sol:ConfigLib";

const addr = (i: number) => ethers.getAddress("0x" + (i + 0x300).toString(16).padStart(40, "0"));

async function harness() {
    const libs = await deployAllLibraries();
    const h = await deployHarness("CoverageHarness", libs);
    // ConfigLib is an external linked library; use a reference to its
    // interface so custom-error matching can resolve its error selectors.
    const configLib = await ethers.getContractAt("ConfigLib", libs[CONFIGLIB_KEY]);
    return { h, configLib };
}

describe("ConfigLib", () => {
    // updateMarket rejects a zero market address.
    it("updateMarket reverts InvalidMarket when m == address(0)", async () => {
        const { h, configLib } = await loadFixture(harness);
        await expect(
            h.testUpdateMarket(ethers.ZeroAddress, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U),
        ).to.be.revertedWithCustomError(configLib, "InvalidMarket");
    });

    describe("updateMarket margin-config disjuncts", () => {
        async function listed() {
            const ctx = await loadFixture(harness);
            const M = addr(1);
            await ctx.h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
            return { ...ctx, M };
        }

        // maintenance margin below the 50 bps minimum.
        it("reverts when mmBps < 50", async () => {
            const { h, configLib, M } = await listed();
            await expect(
                h.testUpdateMarket(M, FEED, 20, e18(1e6), e18(5e6), 49, 1000, 900, U),
            ).to.be.revertedWithCustomError(configLib, "InvalidMarginConfig");
        });

        // maintenance margin above the 5000 bps maximum.
        it("reverts when mmBps > 5000", async () => {
            const { h, configLib, M } = await listed();
            await expect(
                h.testUpdateMarket(M, FEED, 20, e18(1e6), e18(5e6), 6000, 8000, 900, U),
            ).to.be.revertedWithCustomError(configLib, "InvalidMarginConfig");
        });

        // initial margin below the 100 bps minimum.
        it("reverts when imBps < 100", async () => {
            const { h, configLib, M } = await listed();
            await expect(
                h.testUpdateMarket(M, FEED, 20, e18(1e6), e18(5e6), 60, 99, 900, U),
            ).to.be.revertedWithCustomError(configLib, "InvalidMarginConfig");
        });

        // initial margin above the 10000 bps maximum.
        it("reverts when imBps > 10000", async () => {
            const { h, configLib, M } = await listed();
            await expect(
                h.testUpdateMarket(M, FEED, 20, e18(1e6), e18(5e6), 100, 10001, 900, U),
            ).to.be.revertedWithCustomError(configLib, "InvalidMarginConfig");
        });
    });

    // unlistMarket rejects a zero market address.
    it("unlistMarket reverts InvalidMarket when m == address(0)", async () => {
        const { h, configLib } = await loadFixture(harness);
        await expect(h.setUnlistMarket(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            configLib,
            "InvalidMarket",
        );
    });

    // A market that is listed but flagged inactive skips the active-set removal loop.
    it("unlistMarket skips the active-set loop when the market is listed but inactive", async () => {
        const { h } = await loadFixture(harness);
        const M = addr(2);
        await h.testSetMarket(M, FEED, 20, e18(1e6), e18(5e6), 500, 1000, 900, U);
        // Force isMarketActive[m] = false while the market remains listed.
        await h.corruptIsMarketActive(M, false);
        await h.setUnlistMarket(M);
        expect((await h.configMarkets(M)).isListed).to.equal(false);
    });
});
