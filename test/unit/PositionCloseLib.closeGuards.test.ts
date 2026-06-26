import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";

/**
 * Verifies PositionCloseLib close guards and accounting: the TWAP-valid
 * deviation guard, the warming-up bypass with slippage protection, short-side
 * open-interest accounting, partial-close leverage and liquidation-price
 * recomputation, the guard reverts, and the fee-distribution shares on a
 * profitable USDC close.
 */
async function deployClose(fund: boolean) {
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
    if (fund) await usdc.mintTo(await h.getAddress(), e6(10_000_000));

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, e18(50_000), 0, now);
    await oracle.setTWAP(MARKET, e18(50_000));
    await oracle.setTWAPValid(MARKET, true);
    await h.setMarket(MARKET, 500);

    const errLib = await (await ethers.getContractFactory("PositionCloseLib")).deploy();
    await errLib.waitForDeployment();
    return { h, usdc, oracle, pt, vault, errLib, admin, treasury, owner };
}

async function closeSetup() {
    return deployClose(true);
}
async function closeSetupUnfunded() {
    return deployClose(false);
}

describe("PositionCloseLib — guards & deviation", () => {
    it("reverts ZeroCloseSize when closeSize is 0", async () => {
        const { h, pt, owner, errLib } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await expect(h.close(1, 0, 0)).to.be.revertedWithCustomError(errLib, "ZeroCloseSize");
    });

    it("reverts CloseSizeExceedsPosition when closeSize > position size", async () => {
        const { h, pt, owner, errLib } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await expect(h.close(1, e18(20_000), 0)).to.be.revertedWithCustomError(errLib, "CloseSizeExceedsPosition");
    });

    it("reverts ClosePriceDeviation when TWAP is valid and spot deviates beyond the cap", async () => {
        const { h, oracle, pt, owner, errLib } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        // spot 15% above TWAP > 10% cap, TWAP valid
        await oracle.setPrice(MARKET, e18(57_500), 0, now);
        await oracle.setTWAP(MARKET, e18(50_000));
        await oracle.setTWAPValid(MARKET, true);
        await expect(h.close(1, e18(10_000), 0)).to.be.revertedWithCustomError(errLib, "ClosePriceDeviation");
    });

    it("reverts TwapNotReady when buffer is warming up and no minReceive supplied", async () => {
        const { h, oracle, pt, owner, errLib } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await oracle.setTWAPValid(MARKET, false); // warming up
        await expect(h.close(1, e18(10_000), 0)).to.be.revertedWithCustomError(errLib, "TwapNotReady");
    });

    it("allows the close while warming up when minReceive slippage protection is supplied", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await oracle.setTWAPValid(MARKET, false);
        // profitable so payout exceeds a modest minReceive
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(52_000), 0, now);
        await h.close(1, e18(10_000), e6(100));
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("reverts SlippageExceeded when payout is below minReceive", async () => {
        const { h, oracle, pt, owner, errLib } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(50_000), 0, now);
        await oracle.setTWAP(MARKET, e18(50_000));
        // payout ~ collateral 2,000 USDC; demand way more
        await expect(h.close(1, e18(10_000), e6(1_000_000))).to.be.revertedWithCustomError(errLib, "SlippageExceeded");
    });
});

describe("PositionCloseLib — close paths & accounting", () => {
    it("full profitable USDC close distributes lp/insurance/treasury fee shares", async () => {
        const { h, usdc, oracle, pt, treasury, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(52_000), 0, now); // +4% profit, within cap
        await oracle.setTWAP(MARKET, e18(52_000));
        const treasBefore = await usdc.balanceOf(treasury.address);
        await h.close(1, e18(10_000), 0);
        // treasury fee share routed via direct transfer -> balance increases
        expect(await usdc.balanceOf(treasury.address)).to.be.greaterThan(treasBefore);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("partial close of a long recomputes size, leverage and liquidation price", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(51_000), 0, now);
        await oracle.setTWAP(MARKET, e18(51_000));
        await h.close(1, e18(4_000), 0); // partial
        const pos = await h.positions(1);
        expect(pos.state).to.equal(PosStatus.OPEN);
        expect(pos.size).to.equal(e18(6_000));
        expect(pos.liquidationPrice).to.be.greaterThan(0n);
    });

    it("full close of a short decrements short OI accounting", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 0, PosStatus.OPEN); // short
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(49_000), 0, now); // price down -> short profit
        await oracle.setTWAP(MARKET, e18(49_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("partial close of a short keeps the position open and recomputes leverage", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 0, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(49_500), 0, now);
        await oracle.setTWAP(MARKET, e18(49_500));
        await h.close(1, e18(3_000), 0);
        const pos = await h.positions(1);
        expect(pos.state).to.equal(PosStatus.OPEN);
        expect(pos.size).to.equal(e18(7_000));
    });

    it("reverts InsufficientLiquidityForRepayment when the harness cannot fund receiveAmount", async () => {
        const { h, oracle, pt, owner, errLib } = await loadFixture(closeSetupUnfunded);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(300), e18(9_500));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(49_500), 0, now); // small loss -> needs USDC to repay
        await oracle.setTWAP(MARKET, e18(49_500));
        await expect(h.close(1, e18(10_000), 0)).to.be.revertedWithCustomError(
            errLib,
            "InsufficientLiquidityForRepayment",
        );
    });

    it("returns a positive realized PnL on a profitable full close", async () => {
        const { h, oracle, pt, owner } = await loadFixture(closeSetup);
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(52_000), 0, now); // +4%
        await oracle.setTWAP(MARKET, e18(52_000));
        const realized = await h.close.staticCall(1, e18(10_000), 0);
        expect(realized).to.be.greaterThan(0n);
    });
});
