import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, deployProtocol } from "../helpers/fixture";
import { usdc } from "../helpers/constants";

describe("TradingCore — access control and setter guards", () => {
    it("admin-only setters reject non-admins", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(d.tradingCore.connect(d.alice).setContracts(d.bob.address, d.bob.address, d.bob.address)).to.be
            .reverted;
        await expect(d.tradingCore.connect(d.alice).setCollateralRegistry(d.bob.address)).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).setTradingViews(d.bob.address)).to.be.reverted;
        await expect(
            d.tradingCore.connect(d.alice).setFeeConfig({
                makerFeeBps: 1,
                takerFeeBps: 4,
                minFeeUsdc: 0,
                lpShareBps: 7000,
                insuranceShareBps: 2000,
                treasuryShareBps: 1000,
            }),
        ).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).setParams(usdc(10), 0, 0, 0, 0, 0, 0)).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).setLimits(usdc(2000), 0, 0, 0, 0, 0)).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).setMaxFundingIntervals(48)).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).setMinLiquidatorRewardUsdc(usdc(10))).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).setPortfolioRiskConfig(true, true, 500, 4000, 20)).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).setTrustedForwarder(d.bob.address, true)).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).writeDownBadDebt(0)).to.be.reverted;
        await expect(d.tradingCore.connect(d.alice).sweepDust()).to.be.reverted;
    });

    it("setContracts rejects zero addresses", async () => {
        const d = await loadFixture(deployProtocol);
        await expect(
            d.tradingCore.connect(d.admin).setContracts(ethers.ZeroAddress, d.bob.address, d.bob.address),
        ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
    });

    it("setCollateralRegistry rejects zero", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.admin).setCollateralRegistry(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
    });

    it("setMaxFundingIntervals enforces [1,72]", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(d.tradingCore.connect(d.admin).setMaxFundingIntervals(0)).to.be.reverted;
        await expect(d.tradingCore.connect(d.admin).setMaxFundingIntervals(73)).to.be.reverted;
        await d.tradingCore.connect(d.admin).setMaxFundingIntervals(24);
        expect(await d.tradingCore.maxFundingIntervals()).to.equal(24n);
    });

    it("setMinLiquidatorRewardUsdc enforces the <=1000 USDC cap", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(d.tradingCore.connect(d.admin).setMinLiquidatorRewardUsdc(usdc(2000))).to.be.reverted;
        await d.tradingCore.connect(d.admin).setMinLiquidatorRewardUsdc(usdc(100));
    });

    it("setPortfolioRiskConfig rejects out-of-range bps", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.admin).setPortfolioRiskConfig(true, true, 5001, 4000, 20),
        ).to.be.revertedWithCustomError(d.tradingCore, "InvalidParam");
        await expect(
            d.tradingCore.connect(d.admin).setPortfolioRiskConfig(true, true, 500, 10001, 20),
        ).to.be.revertedWithCustomError(d.tradingCore, "InvalidParam");
        await d.tradingCore.connect(d.admin).setPortfolioRiskConfig(true, false, 500, 4000, 20);
    });

    it("setMarketId rejects an over-long id and binds a valid one", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.admin).setMarketId(d.bob.address, "X".repeat(33)),
        ).to.be.revertedWithCustomError(d.tradingCore, "MarketIdTooLong");
        await d.tradingCore.connect(d.admin).setMarketId(d.bob.address, "ETH-USD");
    });

    it("addSubaccount rejects self and zero, removeSubaccount works", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(d.tradingCore.connect(d.alice).addSubaccount(d.alice.address)).to.be.revertedWithCustomError(
            d.tradingCore,
            "InvalidParam",
        );
        await expect(d.tradingCore.connect(d.alice).addSubaccount(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            d.tradingCore,
            "ZeroAddress",
        );
        await d.tradingCore.connect(d.alice).addSubaccount(d.bob.address);
        await d.tradingCore.connect(d.alice).removeSubaccount(d.bob.address);
        expect(await d.tradingCore.isSubaccount(d.alice.address, d.bob.address)).to.equal(false);
    });

    it("pending views return staged proposals", async () => {
        const d = await loadFixture(deployConfigured);
        await d.tradingCore.connect(d.admin).proposeReferralRegistry(d.bob.address);
        const [reg] = await d.tradingCore.pendingReferralRegistry();
        expect(reg).to.equal(d.bob.address);
        const cal = await d.marketCalendar.getAddress();
        const dm = await d.dividendManager.getAddress();
        const cm = await d.compliance.getAddress();
        await d.tradingCore.connect(d.admin).proposeRWAContracts(cal, dm, cm);
        const [pcal] = await d.tradingCore.pendingRWAContracts();
        expect(pcal).to.equal(cal);
    });

    it("setFeeConfig rejects an invalid split", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.admin).setFeeConfig({
                makerFeeBps: 5,
                takerFeeBps: 2, // taker < maker
                minFeeUsdc: 0,
                lpShareBps: 7000,
                insuranceShareBps: 2000,
                treasuryShareBps: 1000,
            }),
        ).to.be.reverted;
    });
});
