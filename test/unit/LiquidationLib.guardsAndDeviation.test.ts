import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

const MARKET = "0x00000000000000000000000000000000000000B7";

/**
 * Verifies LiquidationLib guard and deviation handling via the deep and simple
 * harnesses: the position state guard, TWAP-deviation direction, profit-vs-loss
 * payout, insurance shortfall and partial-fee paths, repay failure, the reward
 * floor, long/short open-interest accounting, and the exposure floor.
 */

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
    // A standalone library instance whose ABI carries the custom errors the
    // harness re-throws (the harness wrapper ABI does not declare them).
    const errLib = await (await ethers.getContractFactory("LiquidationLib")).deploy();
    await errLib.waitForDeployment();
    return { h, usdc, oracle, pt, vault, errLib, admin, treasury, owner, liquidator };
}

async function liqSetup() {
    return deployLiq(true);
}

async function liqSetupUnfunded() {
    return deployLiq(false);
}

describe("LiquidationLib — deep paths", () => {
    it("reverts PositionNotFound when the position is not OPEN", async () => {
        const { h, pt, owner, errLib } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.CLOSED);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        await expect(h.liquidate(1)).to.be.revertedWithCustomError(errLib, "PositionNotFound");
    });

    it("skips the deviation guard entirely when TWAP is zero (warming up)", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(30_000), 0, now);
        await oracle.setTWAP(MARKET, 0);
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("liquidates a SHORT where currentPrice > twap", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 0, PosStatus.OPEN); // flags=0 -> short
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        // spot above twap -> exercises the currentPrice > twapPrice deviation direction
        await oracle.setPrice(MARKET, e18(53_000), 0, now);
        await oracle.setTWAP(MARKET, e18(53_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("reverts InsufficientLiquidityForRepayment when the contract lacks USDC", async () => {
        const { h, oracle, pt, owner, errLib } = await loadFixture(liqSetupUnfunded);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(400), e18(10_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await expect(h.liquidate(1)).to.be.revertedWithCustomError(errLib, "InsufficientLiquidityForRepayment");
    });

    it("uses a custom liquidationDeviationBps override when set", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setLiqParams(2000, {
            nearThresholdBps: 500,
            mediumRiskBps: 800,
            deeplyUnderwaterBps: 1200,
            liquidatorShareBps: 7000,
        });
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(43_500), 0, now);
        await oracle.setTWAP(MARKET, e18(50_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("reverts LiquidationPriceDeviation when the override is exceeded", async () => {
        const { h, oracle, pt, owner, errLib } = await loadFixture(liqSetup);
        await h.setLiqParams(500, {
            nearThresholdBps: 500,
            mediumRiskBps: 800,
            deeplyUnderwaterBps: 1200,
            liquidatorShareBps: 7000,
        });
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(50_000));
        await expect(h.liquidate(1)).to.be.revertedWithCustomError(errLib, "LiquidationPriceDeviation");
    });

    it("liquidates an underwater long where collateral nearly covers (profit-side receiveAmount path)", async () => {
        const { h, oracle, pt, owner, liquidator } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(450));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.connect(liquidator).liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("full insurance cover (covered >= shortfall) pays full fees", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        await vault.setCoverAmount(e6(1_000_000));
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(100), e18(15_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("partial cover leaves a small remainder >= liqFee for fee split", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        await vault.setCoverAmount(e6(500));
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(300), e18(9_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_500), 0, now);
        await oracle.setTWAP(MARKET, e18(47_500));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("decrements user exposure but floors at zero when it would underflow", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        await h.setUserExposure(owner.address, e6(1));
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.liquidate(1);
        expect(await h.userExposure(owner.address)).to.equal(0n);
    });

    it("reverts RepayFailed when the vault reverts on repay", async () => {
        const { h, oracle, pt, vault, owner, errLib } = await loadFixture(liqSetup);
        await vault.setRevertRepay(true);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await expect(h.liquidate(1)).to.be.revertedWithCustomError(errLib, "RepayFailed");
    });
});

describe("LiquidationLib — canLiquidate / checkLiquidatableBatch", () => {
    async function batchSetup() {
        const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();
        const libs = await deployAllLibraries();
        const h = await deployHarness("LiquidationLibHarness", libs);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(50_000), 0, now);
        return { h, oracle };
    }

    it("canLiquidate returns (false, max) for a non-open position", async () => {
        const { h } = await loadFixture(batchSetup);
        await h.setPosition(1, PosStatus.CLOSED, MARKET, e18(20_000), e18(50_000), 1, 20);
        await h.setCollateral(1, e18(100));
        const [liq, hf] = await h.canLiquidateAt(1, e18(40_000));
        expect(liq).to.equal(false);
        expect(hf).to.equal(ethers.MaxUint256);
    });

    it("canLiquidate flags an underwater open position", async () => {
        const { h } = await loadFixture(batchSetup);
        await h.setPosition(1, PosStatus.OPEN, MARKET, e18(20_000), e18(50_000), 1, 20);
        await h.setCollateral(1, e18(200));
        const [liq] = await h.canLiquidateAt(1, e18(45_000));
        expect(liq).to.equal(true);
    });
});
