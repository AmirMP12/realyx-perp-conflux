import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";

/**
 * The delegated views contract drives vault NAV and LP-exit gating,
 * so any non-zero (re)assignment after the first wire-up is staged behind a 48h
 * timelock. First wire-up (done in the fixture) is immediate, and disabling
 * (set to zero) is an immediate emergency action.
 */
describe("TradingCore — setTradingViews timelock", () => {
    const TIMELOCK = 48 * 60 * 60;

    async function deployFreshViews(d: any): Promise<string> {
        const Views = await ethers.getContractFactory("TradingCoreViews");
        const v = await Views.deploy();
        await v.waitForDeployment();
        await v.initialize(await d.tradingCore.getAddress(), await d.vault.getAddress(), await d.oracle.getAddress());
        return v.getAddress();
    }

    it("disabling views (set to zero) is immediate", async () => {
        const d = await loadFixture(deployConfigured);
        await d.tradingCore.connect(d.admin).setTradingViews(ethers.ZeroAddress);
        expect(await d.tradingCore.tradingViews()).to.equal(ethers.ZeroAddress);
    });

    it("rotating to a new non-zero views reverts without a staged proposal", async () => {
        const d = await loadFixture(deployConfigured);
        const newViews = await deployFreshViews(d);
        await expect(d.tradingCore.connect(d.admin).setTradingViews(newViews)).to.be.revertedWithCustomError(
            d.tradingCore,
            "PendingTradingViewsMismatch",
        );
    });

    it("reverts while the timelock has not elapsed", async () => {
        const d = await loadFixture(deployConfigured);
        const newViews = await deployFreshViews(d);
        await d.tradingCore.connect(d.admin).proposeTradingViews(newViews);
        await expect(d.tradingCore.connect(d.admin).setTradingViews(newViews)).to.be.revertedWithCustomError(
            d.tradingCore,
            "TradingViewsTimelockActive",
        );
    });

    it("applies a staged rotation after 48h", async () => {
        const d = await loadFixture(deployConfigured);
        const newViews = await deployFreshViews(d);
        await d.tradingCore.connect(d.admin).proposeTradingViews(newViews);
        const [pending, effective] = await d.tradingCore.pendingTradingViews();
        expect(pending).to.equal(newViews);
        expect(effective).to.be.greaterThan(0n);

        await time.increase(TIMELOCK + 1);
        await d.tradingCore.connect(d.admin).setTradingViews(newViews);
        expect(await d.tradingCore.tradingViews()).to.equal(newViews);

        // Proposal is consumed.
        const [pendingAfter] = await d.tradingCore.pendingTradingViews();
        expect(pendingAfter).to.equal(ethers.ZeroAddress);
    });

    it("rejects a mismatch against the staged proposal", async () => {
        const d = await loadFixture(deployConfigured);
        const a = await deployFreshViews(d);
        const b = await deployFreshViews(d);
        await d.tradingCore.connect(d.admin).proposeTradingViews(a);
        await time.increase(TIMELOCK + 1);
        await expect(d.tradingCore.connect(d.admin).setTradingViews(b)).to.be.revertedWithCustomError(
            d.tradingCore,
            "PendingTradingViewsMismatch",
        );
    });

    it("proposeTradingViews(0) reverts", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.admin).proposeTradingViews(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
    });
});
