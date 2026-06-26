import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";

/**
 * Exercises TradingLib._executeIncrease through the driveOpen harness driver.
 * Each test isolates one risk gate so its revert fires deterministically
 * without routing through the full TradingCore engine.
 */
async function setup() {
    const [admin] = await ethers.getSigners();
    const libs = await deployAllLibraries();
    const h = await deployHarness("CoverageHarness", libs);

    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();
    const Vault = await ethers.getContractFactory("MockVaultForOpen");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    await vault.setUsdc(await usdc.getAddress());
    const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const PT = await ethers.getContractFactory("MockPositionTokenSimple");
    const pt = await PT.deploy();
    await pt.waitForDeployment();

    await usdc.mintTo(await h.getAddress(), e6(10_000_000));
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, e18(50_000), 0, now);
    await oracle.setTWAP(MARKET, e18(50_000));
    await oracle.setTWAPValid(MARKET, true);

    await h.configureOpenMarket(MARKET, true, true, ethers.parseUnits("100000000", 18), ethers.parseUnits("500000000", 18), 100, 0);
    await h.setOpenWiring(await usdc.getAddress(), await vault.getAddress(), await oracle.getAddress(), false);
    await h.setOpenPositionToken(await pt.getAddress());

    const base = {
        account: admin.address,
        orderType: 0,
        isLong: true,
        sizeDelta: e6(10_000),
        collateralDelta: e6(2_000),
        triggerPrice: 0n,
        maxSlippage: 0n,
        stopLossPrice: 0n,
        takeProfitPrice: 0n,
        currentPrice: e18(50_000),
        minPositionSize: e6(10),
        maxUserExposure: 0n,
        userDailyVolumeLimit: 0n,
        globalDailyVolumeLimit: 0n,
        nextPositionId: 1n,
    };
    return { h, usdc, vault, oracle, admin, base };
}

describe("TradingLib._executeIncrease", () => {
    it("opens a valid market-increase position (happy path)", async () => {
        const { h, base } = await loadFixture(setup);
        await h.driveOpen(base);
        const pos = await h.getDrivenPosition(1);
        expect(pos.state).to.equal(1);
        expect(pos.size).to.equal(e18(10_000));
    });

    it("reverts MarketNotActive when inactive", async () => {
        const { h, base } = await loadFixture(setup);
        await h.configureOpenMarket(MARKET, false, true, ethers.parseUnits("100000000", 18), ethers.parseUnits("500000000", 18), 100, 0);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts MarketNotActive when not listed", async () => {
        const { h, base } = await loadFixture(setup);
        await h.configureOpenMarket(MARKET, true, false, ethers.parseUnits("100000000", 18), ethers.parseUnits("500000000", 18), 100, 0);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts PositionTooSmall below minPositionSize", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, sizeDelta: e6(5), minPositionSize: e6(10) })).to.be.reverted;
    });

    it("reverts ExceedsMaxPositionSize", async () => {
        const { h, base } = await loadFixture(setup);
        await h.configureOpenMarket(MARKET, true, true, e18(1000), ethers.parseUnits("500000000", 18), 100, 0);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts ExceedsMaxTotalExposure (market OI cap)", async () => {
        const { h, base } = await loadFixture(setup);
        await h.configureOpenMarket(MARKET, true, true, ethers.parseUnits("100000000", 18), e18(1000), 100, 0);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts ExceedsMaxTotalExposure (per-user cap)", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, maxUserExposure: e6(100) })).to.be.reverted;
    });

    it("reverts RateLimitExceededOpen (daily volume)", async () => {
        const { h, admin, base } = await loadFixture(setup);
        await h.seedOpenDailyVolume(admin.address, e6(9_500), e6(9_500));
        await expect(
            h.driveOpen({ ...base, userDailyVolumeLimit: e6(10_000), globalDailyVolumeLimit: e6(100_000) }),
        ).to.be.reverted;
    });

    it("reverts InvalidOraclePrice when current price is zero", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, currentPrice: 0n })).to.be.reverted;
    });

    it("reverts OpenPriceDeviation on a cold TWAP buffer", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await oracle.setTWAPValid(MARKET, false);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts OpenPriceDeviation when spot deviates from TWAP", async () => {
        const { h, oracle, base } = await loadFixture(setup);
        await oracle.setTWAP(MARKET, e18(40_000));
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts SlippageExceeded for a market trigger beyond maxSlippage", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, triggerPrice: e18(47_000), maxSlippage: 10n })).to.be.reverted;
    });

    it("reverts InsufficientCollateral when collateral barely covers the fee", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, sizeDelta: e6(1_000_000), collateralDelta: e6(1) })).to.be.reverted;
    });

    it("reverts ExceedsMaxLeverage", async () => {
        const { h, base } = await loadFixture(setup);
        await h.configureOpenMarket(MARKET, true, true, ethers.parseUnits("100000000", 18), ethers.parseUnits("500000000", 18), 2, 0);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts InsufficientCollateral on the initial-margin floor", async () => {
        const { h, base } = await loadFixture(setup);
        await h.configureOpenMarket(MARKET, true, true, ethers.parseUnits("100000000", 18), ethers.parseUnits("500000000", 18), 100, 5000);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("reverts InsufficientLiquidity when the vault borrow fails", async () => {
        const { h, vault, base } = await loadFixture(setup);
        await vault.setBorrowSucceeds(false);
        await expect(h.driveOpen(base)).to.be.reverted;
    });

    it("opens with a valid SL and TP at entry (long)", async () => {
        const { h, base } = await loadFixture(setup);
        await h.driveOpen({ ...base, stopLossPrice: e18(45_000), takeProfitPrice: e18(60_000) });
        const pos = await h.getDrivenPosition(1);
        expect(pos.stopLossPrice).to.equal(e18(45_000));
        expect(pos.takeProfitPrice).to.equal(e18(60_000));
    });

    it("reverts a contradictory SL above price (long)", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, stopLossPrice: e18(55_000) })).to.be.reverted;
    });

    it("reverts a contradictory TP below price (long)", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, takeProfitPrice: e18(45_000) })).to.be.reverted;
    });

    it("opens a short with valid SL above and TP below the price", async () => {
        const { h, base } = await loadFixture(setup);
        await h.driveOpen({ ...base, isLong: false, stopLossPrice: e18(55_000), takeProfitPrice: e18(45_000) });
        expect((await h.getDrivenPosition(1)).stopLossPrice).to.equal(e18(55_000));
    });

    it("reverts a short SL below price", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, isLong: false, stopLossPrice: e18(45_000) })).to.be.reverted;
    });

    it("reverts a short TP above price", async () => {
        const { h, base } = await loadFixture(setup);
        await expect(h.driveOpen({ ...base, isLong: false, takeProfitPrice: e18(55_000) })).to.be.reverted;
    });

    it("opens with collateral >= size (no borrow path)", async () => {
        const { h, base } = await loadFixture(setup);
        await h.driveOpen({ ...base, collateralDelta: e6(11_000) });
        expect((await h.getDrivenPosition(1)).state).to.equal(1);
    });

    it("opens a short market-increase (short OI path)", async () => {
        const { h, base } = await loadFixture(setup);
        await h.driveOpen({ ...base, isLong: false });
        expect((await h.getDrivenPosition(1)).state).to.equal(1);
    });

    it("records daily volume when limits are configured (update path)", async () => {
        const { h, base } = await loadFixture(setup);
        await h.driveOpen({ ...base, userDailyVolumeLimit: e6(1_000_000), globalDailyVolumeLimit: e6(100_000_000) });
        expect((await h.getDrivenPosition(1)).state).to.equal(1);
    });
});
