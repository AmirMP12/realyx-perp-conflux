import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

const MARKET = "0x00000000000000000000000000000000000000B7";

/**
 * Exercises the full close and liquidation paths through the dedicated deep
 * harnesses (PositionCloseLibHarness, LiquidationLibHarnessDeep) across profit,
 * loss, bad-debt, and insurance-cover scenarios.
 */

async function closeSetup() {
    const [admin, treasury, owner] = await ethers.getSigners();
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
    const h = await deployHarness("PositionCloseLibHarness", libs, [
        await usdc.getAddress(),
        await vault.getAddress(),
        await oracle.getAddress(),
        await pt.getAddress(),
        treasury.address,
    ]);

    // Fund the harness with USDC so repay/payout transfers succeed.
    await usdc.mintTo(await h.getAddress(), e6(10_000_000));
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, e18(50_000), 0, now);
    await oracle.setTWAP(MARKET, e18(50_000));
    await oracle.setTWAPValid(MARKET, true);
    await h.setMarket(MARKET, 500);
    return { h, usdc, oracle, pt, vault, admin, treasury, owner };
}

describe("PositionCloseLib full close paths", () => {
    it("closes a profitable long fully (TWAP valid)", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(55_000), 0, now); // +10%
        await oracle.setTWAP(MARKET, e18(55_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("partial close keeps the position open and recomputes leverage", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(4_000));
        await pt.setOwner(1, owner.address);
        await h.close(1, e18(10_000), 0); // close half
        const pos = await h.positions(1);
        expect(pos.state).to.equal(PosStatus.OPEN);
        expect(pos.size).to.equal(e18(10_000));
    });

    it("closes a losing long deducting from collateral", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(3_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(48_000), 0, now); // -4%
        await oracle.setTWAP(MARKET, e18(48_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("closes a short at a profit", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 0, PosStatus.OPEN); // short
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(45_000), 0, now); // -10% favors short
        await oracle.setTWAP(MARKET, e18(45_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("reverts when TWAP not ready and no slippage protection", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await oracle.setTWAPValid(MARKET, false);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await expect(h.close(1, e18(10_000), 0)).to.be.reverted; // TwapNotReady
    });

    it("allows close when TWAP not ready but minReceive supplied", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await oracle.setTWAPValid(MARKET, false);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await h.close(1, e18(10_000), 1); // minReceive non-zero
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("reverts on TWAP deviation beyond cap", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        // spot 50k vs twap 40k -> 25% deviation > 10% cap
        await oracle.setPrice(MARKET, e18(50_000), 0, now);
        await oracle.setTWAP(MARKET, e18(40_000));
        await expect(h.close(1, e18(10_000), 0)).to.be.reverted; // ClosePriceDeviation
    });

    it("reverts closeSize 0 and closeSize > position", async () => {
        const { h, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await expect(h.close(1, 0, 0)).to.be.reverted; // ZeroCloseSize
        await expect(h.close(1, e18(20_000), 0)).to.be.reverted; // CloseSizeExceedsPosition
    });

    it("reverts on slippage when payout below minReceive", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await expect(h.close(1, e18(10_000), e6(10_000_000))).to.be.reverted; // SlippageExceeded
    });

    it("covers bad debt from insurance when underwater (cover>0)", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(closeSetup);
        await vault.setCoverAmount(e6(5_000)); // insurance can cover
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(500), e18(9_500)); // big borrow, small collateral
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(40_000), 0, now); // -20% loss
        await oracle.setTWAP(MARKET, e18(40_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("handles failed bad-debt coverage (cover=0) without locking", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(closeSetup);
        await vault.setCoverAmount(0); // insurance cannot cover
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(500), e18(9_500));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(40_000), 0, now);
        await oracle.setTWAP(MARKET, e18(40_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });
});

async function liqSetup() {
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

    await usdc.mintTo(await h.getAddress(), e6(10_000_000));
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, e18(50_000), 0, now);
    await oracle.setTWAP(MARKET, e18(50_000));
    return { h, usdc, oracle, pt, vault, admin, treasury, owner, liquidator };
}

describe("LiquidationLib full liquidation paths", () => {
    it("liquidates an underwater long cleanly (collateral covers)", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now); // -6%
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("reverts liquidation of a healthy position", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(5_000));
        await pt.setOwner(1, owner.address);
        await expect(h.liquidate(1)).to.be.reverted; // PositionNotLiquidatable
    });

    it("reverts on liquidation price deviation", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(40_000), 0, now);
        await oracle.setTWAP(MARKET, e18(50_000)); // 20% deviation > 10% default
        await expect(h.liquidate(1)).to.be.reverted; // LiquidationPriceDeviation
    });

    it("liquidates with insurance cover for shortfall (bad debt)", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        await vault.setCoverAmount(e6(20_000));
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(200), e18(19_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(46_000), 0, now); // -8%
        await oracle.setTWAP(MARKET, e18(46_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("liquidates recording failed repayment when cover=0 (residual debt)", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        await vault.setCoverAmount(0);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(200), e18(19_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(46_000), 0, now);
        await oracle.setTWAP(MARKET, e18(46_000));
        // tradingCore is set to the harness itself; recordFailedRepayment is a
        // no-op selector on the harness, so it must not revert.
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("reverts when vault repay fails", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        await vault.setRevertRepay(true);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(400));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await expect(h.liquidate(1)).to.be.reverted; // RepayFailed
    });

    it("partial insurance cover leaves limited fees for liquidator/insurance", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        // shortfall exists but cover makes actualAvailable >= receiveAmount with
        // only a small remainder left for fees (remainingForFees).
        await vault.setCoverAmount(e6(300));
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(300), e18(9_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_500), 0, now); // -5%
        await oracle.setTWAP(MARKET, e18(47_500));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("emits LiquidatorRewardCapped when reward falls below the floor (clean liquidation)", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        // a healthy-ish liquidation where the tiered fee is tiny relative to the
        // 25% floor -> reward-capped warning path while the position still closes.
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(420));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });
});

describe("LiquidationLib.checkLiquidatableBatch", () => {
    async function deploy() {
        const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();
        const libs = await deployAllLibraries();
        const h = await deployHarness("LiquidationLibHarness", libs);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(50_000), 0, now);
        return { h, oracle };
    }

    it("flags underwater open positions and skips closed ones", async () => {
        const { h, oracle } = await loadFixture(deploy);
        // id 1: underwater long (high leverage, crashed price)
        await h.setPosition(1, PosStatus.OPEN, MARKET, e18(20_000), e18(50_000), 1, 20);
        await h.setCollateral(1, e18(200));
        // id 2: closed -> sentinel max health, not liquidatable
        await h.setPosition(2, PosStatus.CLOSED, MARKET, e18(10_000), e18(50_000), 1, 5);
        await h.setCollateral(2, e18(5_000));
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(45_000), 0, now); // -10% crash
        const [liq, hfs] = await h.checkBatch([1, 2], await oracle.getAddress(), [MARKET, MARKET]);
        expect(liq[0]).to.equal(true);
        expect(liq[1]).to.equal(false);
        expect(hfs[1]).to.equal(ethers.MaxUint256);
    });

    it("healthy open position is not flagged", async () => {
        const { h, oracle } = await loadFixture(deploy);
        await h.setPosition(1, PosStatus.OPEN, MARKET, e18(10_000), e18(50_000), 1, 3);
        await h.setCollateral(1, e18(5_000));
        const [liq] = await h.checkBatch([1], await oracle.getAddress(), [MARKET]);
        expect(liq[0]).to.equal(false);
    });
});
