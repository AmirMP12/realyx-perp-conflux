import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const MARKET = "0x00000000000000000000000000000000000000B7";

async function frHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("TradingLibFailedRepaymentHarness", libs);
}

async function mockUsdc() {
    const M = await ethers.getContractFactory("MockUSDC");
    const m = await M.deploy();
    await m.waitForDeployment();
    return m;
}

async function mockVault() {
    const V = await ethers.getContractFactory("MockVaultControl");
    const v = await V.deploy();
    await v.waitForDeployment();
    return v;
}

describe("TradingLib failed-repayment lifecycle", () => {
    it("records a new failed repayment and accumulates a second leg", async () => {
        const h = await loadFixture(frHarness);
        await h.boostRecordFailedRepayment(1, e6(100), MARKET, true, e18(5));
        // second leg on same position accumulates instead of dropping
        await h.boostRecordFailedRepayment(1, e6(50), MARKET, true, e18(3));
        // a distinct position id pushes a new entry
        await h.boostRecordFailedRepayment(2, e6(200), MARKET, false, -e18(2));
    });

    it("applyLiquidatePostProcess increments count and accrues bad debt when recorded", async () => {
        const h = await loadFixture(frHarness);
        const [newTotal, badDebt] = await h.boostApplyLiquidatePostProcess.staticCall(
            1,
            true, // didRecordFailed
            e18(1000), // totalBadDebt seeded
            e6(100), // failedAmount (USDC) -> +100e18 internal
            0, // totalFailedRepayments before
        );
        expect(newTotal).to.equal(1n);
        // bad debt grows by the recorded failed amount converted to internal precision
        expect(badDebt).to.equal(e18(1000) + e18(100));
    });

    it("applyLiquidatePostProcess is a no-op for the count when nothing recorded", async () => {
        const h = await loadFixture(frHarness);
        const [newTotal] = await h.boostApplyLiquidatePostProcess.staticCall(1, false, 0, 0, 3);
        expect(newTotal).to.equal(3n);
    });

    it("resolveFailedRepayment repays from harness balance and marks resolved", async () => {
        const h = await loadFixture(frHarness);
        const usdc = await mockUsdc();
        const vault = await mockVault();
        const [sender] = await ethers.getSigners();
        await h.boostRecordFailedRepayment(1, e6(100), MARKET, true, e18(5));
        // fund the harness so it does not need to pull from sender
        await usdc.mintTo(await h.getAddress(), e6(1000));
        await h.boostResolveFailedRepayment(
            1,
            sender.address,
            await h.getAddress(),
            await usdc.getAddress(),
            await vault.getAddress(),
        );
    });

    it("resolveFailedRepayment pulls the shortfall from the sender", async () => {
        const h = await loadFixture(frHarness);
        const usdc = await mockUsdc();
        const vault = await mockVault();
        const [sender] = await ethers.getSigners();
        await h.boostRecordFailedRepayment(1, e6(100), MARKET, true, e18(5));
        // harness holds nothing -> must pull full amount from sender
        await usdc.mintTo(sender.address, e6(1000));
        await usdc.connect(sender).approve(await h.getAddress(), ethers.MaxUint256);
        await h.boostResolveFailedRepayment(
            1,
            sender.address,
            await h.getAddress(),
            await usdc.getAddress(),
            await vault.getAddress(),
        );
    });

    it("resolveFailedRepayment reverts on an unknown/resolved record", async () => {
        const h = await loadFixture(frHarness);
        const usdc = await mockUsdc();
        const vault = await mockVault();
        const [sender] = await ethers.getSigners();
        await expect(
            h.boostResolveFailedRepayment(
                99,
                sender.address,
                await h.getAddress(),
                await usdc.getAddress(),
                await vault.getAddress(),
            ),
        ).to.be.reverted; // InvalidOrResolvedFailedRepayment
    });

    it("resolveFailedRepayment reverts and refunds sender when vault repay fails", async () => {
        const h = await loadFixture(frHarness);
        const usdc = await mockUsdc();
        const vault = await mockVault();
        await vault.setRevertRepay(true);
        const [sender] = await ethers.getSigners();
        await h.boostRecordFailedRepayment(1, e6(100), MARKET, true, e18(5));
        await usdc.mintTo(sender.address, e6(1000));
        await usdc.connect(sender).approve(await h.getAddress(), ethers.MaxUint256);
        const before = await usdc.balanceOf(sender.address);
        await expect(
            h.boostResolveFailedRepayment(
                1,
                sender.address,
                await h.getAddress(),
                await usdc.getAddress(),
                await vault.getAddress(),
            ),
        ).to.be.reverted; // RepaymentValidationFailed (sender refunded)
        expect(await usdc.balanceOf(sender.address)).to.equal(before);
    });

    it("resolveFailedRepaymentFull resolves, dequeues the id, and decrements bad debt", async () => {
        const h = await loadFixture(frHarness);
        const usdc = await mockUsdc();
        const vault = await mockVault();
        const [sender] = await ethers.getSigners();
        await h.boostRecordFailedRepayment(1, e6(100), MARKET, true, e18(5));
        await usdc.mintTo(await h.getAddress(), e6(1000));
        const [newTotal] = await h.boostResolveFailedRepaymentFull.staticCall(
            1,
            sender.address,
            await h.getAddress(),
            await usdc.getAddress(),
            await vault.getAddress(),
            1,
        );
        expect(newTotal).to.equal(0n);
        await h.boostResolveFailedRepaymentFull(
            1,
            sender.address,
            await h.getAddress(),
            await usdc.getAddress(),
            await vault.getAddress(),
            1,
        );
    });
});

async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

describe("TradingLib settlePositionFunding & getActivePositions", () => {
    it("settlePositionFunding charges an open position and stamps lastFundingTime", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(50_000), 0, now);

        await h.setPositionSimple(1, e18(10_000), e18(50_000), 1, PosStatus.OPEN, MARKET);
        await h.setCollateral(1, e18(2_000));
        // cumulative funding delta so the position owes funding
        await h.setFundingState(MARKET, 0, e18(1) / 100n, BigInt(now), e18(1000), e18(500));
        await h.setPositionCumulativeFunding(1, 0);
        await h.testTradingLibSettlePositionFunding(1, await oracle.getAddress());
    });

    it("settlePositionFunding reverts for a non-open position", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        await expect(h.testTradingLibSettlePositionFunding(7, await oracle.getAddress())).to.be.reverted;
    });

    it("getActivePositions returns only OPEN ids", async () => {
        const h = await loadFixture(coverageHarness);
        await h.setPositionSimple(1, e18(100), e18(100), 1, PosStatus.OPEN, MARKET);
        await h.setPositionSimple(2, e18(100), e18(100), 1, PosStatus.CLOSED, MARKET);
        await h.setPositionSimple(3, e18(100), e18(100), 1, PosStatus.OPEN, MARKET);
        await h.addPositionId(1);
        await h.addPositionId(2);
        await h.addPositionId(3);
        const ids = await h.testGetActivePositions();
        expect(ids.length).to.equal(2);
    });
});
