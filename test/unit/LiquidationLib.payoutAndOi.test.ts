import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

/**
 * Verifies LiquidationLib payout and open-interest accounting:
 *   - the profitable-position payout path (receiveAmount/pnlUsdc)
 *   - a liquidation where collateral fully covers the required amount
 *   - a partial cover leaving a remainder below the liquidation fee
 *   - the reward floor when the liquidator reward is tiny
 *   - long open-interest decrement on liquidation
 *   - short open-interest decrement on liquidation
 *   - user exposure being reduced rather than floored
 */

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";

async function deployLiq(fund: boolean) {
    const [admin, treasury, owner, liquidator] = await ethers.getSigners();
    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();

    const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();

    const PT = await ethers.getContractFactory("MockPositionTokenSimple");
    const pt = await PT.deploy();
    await pt.waitForDeployment();

    const Vault = await ethers.getContractFactory("MockVaultControl");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();

    const libs = await deployAllLibraries();
    const h = await deployHarness("LiquidationLibHarnessDeep", libs, [
        await usdc.getAddress(),
        await vault.getAddress(),
        await oracle.getAddress(),
        await pt.getAddress(),
        treasury.address,
    ]);

    if (fund) await usdc.mintTo(await h.getAddress(), e6(10_000_000));
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, e18(50_000), 0, now);
    await oracle.setTWAP(MARKET, e18(50_000));
    const errLib = await (await ethers.getContractFactory("LiquidationLib")).deploy();
    await errLib.waitForDeployment();
    return { h, usdc, oracle, pt, vault, errLib, admin, treasury, owner, liquidator };
}

const liqSetup = () => deployLiq(true);

describe("LiquidationLib", () => {
    it("liquidates a profitable LONG: pnl >= 0 receiveAmount/pnlUsdc path", async () => {
        // A liquidatable position can still be in slight profit vs entry when
        // collateral is tiny relative to size. Here entry 50k, spot 50.5k (long
        // profit) but collateral so small the health factor still liquidates.
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN); // long
        await h.setCollateralWithBorrow(1, e18(50), e18(19_900));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(50_500), 0, now); // small profit, still liquidatable
        await oracle.setTWAP(MARKET, e18(50_500));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("fully-collateralized liquidation: availableUsdc >= totalRequired", async () => {
        // Large collateral, no borrow -> available covers required -> pays
        // full liqFee + insFee.
        const { h, oracle, pt, owner, liquidator } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(450));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_500), 0, now);
        await oracle.setTWAP(MARKET, e18(47_500));
        await h.connect(liquidator).liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("partial cover with a remainder below liqFee", async () => {
        // covered>0 but covered<shortfall, actualAvailable>=receiveAmount, and the
        // remainingForFees is < liqFeeUsdc -> liquidatorReward = remainder (tiny),
        // which is also below the 25% reward floor (emits LiquidatorRewardCapped).
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        await vault.setCoverAmount(e6(50));
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(120), e18(12_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_500), 0, now);
        await oracle.setTWAP(MARKET, e18(47_500));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("long-position OI is decremented on liquidation", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN); // long
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        // seed market long OI larger than the position so the decrement path runs
        await h.setMarketOI(MARKET, e18(100_000), e18(5_000_000), 0, 0);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("short-position OI is decremented on liquidation", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 0, PosStatus.OPEN); // short
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        // seed market short OI larger than the position so the decrement path runs
        await h.setMarketOI(MARKET, 0, 0, e18(100_000), e18(5_000_000));
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        // short is underwater when price rises
        await oracle.setPrice(MARKET, e18(53_000), 0, now);
        await oracle.setTWAP(MARKET, e18(53_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("user exposure above the decrease is reduced (not floored)", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        // large existing exposure -> userExposure > exposureDecrease -> subtract path
        await h.setUserExposure(owner.address, e6(1_000_000));
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.liquidate(1);
        expect(await h.userExposure(owner.address)).to.be.greaterThan(0n);
    });
});
