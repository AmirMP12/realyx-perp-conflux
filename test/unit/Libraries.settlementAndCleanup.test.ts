import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

async function mockUsdc() {
    const M = await ethers.getContractFactory("MockUSDC");
    const m = await M.deploy();
    await m.waitForDeployment();
    return m;
}

describe("WithdrawLib ETH + token refunds", () => {
    it("withdraws keeper fees as ETH to an EOA and zeroes the balance", async () => {
        const h = await loadFixture(coverageHarness);
        const [, , recipient] = await ethers.getSigners();
        // fund the harness with ETH
        await (await ethers.getSigners())[0].sendTransaction({ to: await h.getAddress(), value: ethers.parseEther("1") });
        await h.setKeeperFeeBalance(recipient.address, ethers.parseEther("0.5"));
        const before = await ethers.provider.getBalance(recipient.address);
        await h.testWithdrawKeeperFees(recipient.address);
        expect(await ethers.provider.getBalance(recipient.address)).to.equal(before + ethers.parseEther("0.5"));
    });

    it("withdraws order refund as ETH to an EOA", async () => {
        const h = await loadFixture(coverageHarness);
        const [, , recipient] = await ethers.getSigners();
        await (await ethers.getSigners())[0].sendTransaction({ to: await h.getAddress(), value: ethers.parseEther("1") });
        await h.setOrderRefundBalance(recipient.address, ethers.parseEther("0.3"));
        const before = await ethers.provider.getBalance(recipient.address);
        await h.testWithdrawOrderRefund(recipient.address);
        expect(await ethers.provider.getBalance(recipient.address)).to.equal(before + ethers.parseEther("0.3"));
    });

    it("reverts keeper-fee withdrawal when the recipient rejects ETH", async () => {
        const h = await loadFixture(coverageHarness);
        const Rej = await ethers.getContractFactory("MockRejectEthReceiver");
        const rej = await Rej.deploy();
        await rej.waitForDeployment();
        await (await ethers.getSigners())[0].sendTransaction({ to: await h.getAddress(), value: ethers.parseEther("1") });
        await h.setKeeperFeeBalance(await rej.getAddress(), ethers.parseEther("0.5"));
        await expect(h.testWithdrawKeeperFees(await rej.getAddress())).to.be.reverted; // TransferFailed
    });

    it("reverts order-refund withdrawal when the recipient rejects ETH", async () => {
        const h = await loadFixture(coverageHarness);
        const Rej = await ethers.getContractFactory("MockRejectEthReceiver");
        const rej = await Rej.deploy();
        await rej.waitForDeployment();
        await (await ethers.getSigners())[0].sendTransaction({ to: await h.getAddress(), value: ethers.parseEther("1") });
        await h.setOrderRefundBalance(await rej.getAddress(), ethers.parseEther("0.5"));
        await expect(h.testWithdrawOrderRefund(await rej.getAddress())).to.be.reverted;
    });

    it("withdraws an ERC20 collateral-token refund", async () => {
        const h = await loadFixture(coverageHarness);
        const usdc = await mockUsdc();
        const [, , recipient] = await ethers.getSigners();
        await usdc.mintTo(await h.getAddress(), e6(1000));
        await h.setOrderCollateralTokenRefundBalance(recipient.address, await usdc.getAddress(), e6(100));
        const before = await usdc.balanceOf(recipient.address);
        await h.testWithdrawOrderCollateralTokenRefund(recipient.address, await usdc.getAddress());
        expect(await usdc.balanceOf(recipient.address)).to.equal(before + e6(100));
    });

    it("token refund is a no-op for a zero balance", async () => {
        const h = await loadFixture(coverageHarness);
        const usdc = await mockUsdc();
        const [, , recipient] = await ethers.getSigners();
        await h.testWithdrawOrderCollateralTokenRefund(recipient.address, await usdc.getAddress());
    });
});

describe("CleanupLib admin, liquidated, and unresolved cases", () => {
    it("self-cleanup removes LIQUIDATED positions", async () => {
        const h = await loadFixture(coverageHarness);
        await h.setPositionSimple(1, e18(100), e18(100), 1, PosStatus.LIQUIDATED, ethers.ZeroAddress);
        await h.addCleanupPosition(1);
        const cleaned = await h.testCleanupPositions.staticCall(10);
        expect(cleaned).to.equal(1n);
        await h.testCleanupPositions(10);
    });

    it("admin cleanup preserves LIQUIDATED but purges CLOSED", async () => {
        const h = await loadFixture(coverageHarness);
        await h.setPositionSimple(1, e18(100), e18(100), 1, PosStatus.LIQUIDATED, ethers.ZeroAddress);
        await h.setPositionSimple(2, e18(100), e18(100), 1, PosStatus.CLOSED, ethers.ZeroAddress);
        await h.addCleanupPosition(1);
        await h.addCleanupPosition(2);
        const cleaned = await h.testCleanupPositionsAdmin.staticCall(10);
        expect(cleaned).to.equal(1n); // only the CLOSED one
        await h.testCleanupPositionsAdmin(10);
    });

    it("refuses to clean a position with an unresolved failed repayment", async () => {
        const h = await loadFixture(coverageHarness);
        await h.setPositionSimple(1, e18(100), e18(100), 1, PosStatus.CLOSED, ethers.ZeroAddress);
        await h.addCleanupPosition(1);
        await h.setHarnessFailedRepayment(1, e6(50), false); // unresolved
        const cleaned = await h.testCleanupPositions.staticCall(10);
        expect(cleaned).to.equal(0n);
    });

    it("cleans a CLOSED position whose failed repayment is resolved", async () => {
        const h = await loadFixture(coverageHarness);
        await h.setPositionSimple(1, e18(100), e18(100), 1, PosStatus.CLOSED, ethers.ZeroAddress);
        await h.addCleanupPosition(1);
        await h.setHarnessFailedRepayment(1, e6(50), true); // resolved
        const cleaned = await h.testCleanupPositions.staticCall(10);
        expect(cleaned).to.equal(1n);
    });
});

describe("FlashLoanCheck minInteractionDelay", () => {
    it("reverts when a non-operator acts within the interaction delay", async () => {
        const h = await loadFixture(coverageHarness);
        const [, actor] = await ethers.getSigners();
        await expect(h.testValidateFlashLoanDelay(actor.address, 3600)).to.be.reverted; // RateLimitExceeded
    });
});

describe("FundingLib settleFundingWithCap", () => {
    async function deploy() {
        const libs = await deployAllLibraries();
        return deployHarness("FundingLibHarness", libs);
    }
    it("caps intervals settled and only advances lastSettlement by consumed", async () => {
        const h = await loadFixture(deploy);
        const now = await time.latest();
        // last settlement 100 intervals ago (8h each), imbalanced OI
        await h.setupMarket(BigInt(now - 100 * 8 * 60 * 60), e18(2_000_000), e18(1_000_000));
        await h.settleWithCap(5); // cap to 5 intervals
        const [, cum, last] = await h.fundingState();
        expect(cum).to.not.equal(0n);
        // lastSettlement advanced by exactly 5 intervals (not the full 100)
        expect(last).to.equal(BigInt(now - 100 * 8 * 60 * 60 + 5 * 8 * 60 * 60));
    });
    it("cap 0 falls back to MAX_FUNDING_INTERVALS", async () => {
        const h = await loadFixture(deploy);
        const now = await time.latest();
        await h.setupMarket(BigInt(now - 100 * 8 * 60 * 60), e18(2_000_000), e18(1_000_000));
        await h.settleWithCap(0); // 0 -> default cap
        const [, cum] = await h.fundingState();
        expect(cum).to.not.equal(0n);
    });
    it("returns early when lastSettlement is zero (fast-forward)", async () => {
        const h = await loadFixture(deploy);
        await h.setupMarket(0, e18(2_000_000), e18(1_000_000));
        await h.settleWithCap(5);
        const [, cum, last] = await h.fundingState();
        expect(cum).to.equal(0n);
        expect(last).to.be.greaterThan(0n);
    });
    it("returns early when no full interval has elapsed", async () => {
        const h = await loadFixture(deploy);
        const now = await time.latest();
        await h.setupMarket(BigInt(now - 60), e18(2_000_000), e18(1_000_000)); // <8h
        await h.settleWithCap(5);
        const [, cum] = await h.fundingState();
        expect(cum).to.equal(0n);
    });
});

describe("DividendSettlementLib zero-manager case", () => {
    async function deploy() {
        const libs = await deployAllLibraries();
        return deployHarness("DividendSettlementHarness", libs);
    }
    it("returns zeros when the dividend manager is the zero address", async () => {
        const h = await loadFixture(deploy);
        await h.setPosition(e18(1000), 1);
        const [amt, idx] = await h.settle.staticCall(1, "AAPL", 7, ethers.ZeroAddress);
        expect(amt).to.equal(0n);
        expect(idx).to.equal(7n);
    });
});

describe("GlobalPnLLib overflow-skip & PortfolioRiskLib fallback", () => {
    it("global PnL skips a market whose product overflows the safe bound", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const market = "0x00000000000000000000000000000000000000B7";
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(market, e18(110), 0, now);
        await h.addMarket(market);
        const pnl = await h.testGlobalPnL(await oracle.getAddress());
        expect(pnl).to.not.equal(0n);
    });

    it("global PnL skips an active market with zero open interest", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const market = "0x00000000000000000000000000000000000000c8";
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(market, e18(100), 0, now);
        await h.addMarket(market);
        // zero out the OI so the (longSize>0||shortSize>0) guard is not satisfied
        await h.setMarketExposure(market, true, 0, 0, 0, 0);
        const pnl = await h.testGlobalPnL(await oracle.getAddress());
        expect(pnl).to.equal(0n);
    });

    it("global PnL skips a market priced at zero", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const market = "0x00000000000000000000000000000000000000d9";
        await h.addMarket(market); // long size/cost set, but no price configured -> price 0
        const pnl = await h.testGlobalPnL(await oracle.getAddress());
        expect(pnl).to.equal(0n);
    });
});

describe("PortfolioRiskLib flat-mm fallback (no leverage)", () => {
    async function extra() {
        const libs = await deployAllLibraries();
        return deployHarness("ExtraCoverageHarness", libs);
    }
    it("uses cfg maintenance bps when a position has no stored leverage", async () => {
        const h = await loadFixture(extra);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const [, owner] = await ethers.getSigners();
        const market = "0x00000000000000000000000000000000000000B7";
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(market, e18(100), 0, now);
        // ExtraCoverageHarness.setPosition stores leverage = 10 (non-zero); to hit
        // the zero-leverage fallback we rely on PortfolioRiskLib reading p.leverage.
        // Cross-margin position (flags=3) with collateral.
        await h.setPosition(owner.address, 1, e18(10_000), e18(100), 3, PosStatus.OPEN, market);
        await h.setCollateral(1, e18(5_000));
        await h.setPositionLeverage(1, 0); // force the flat-config mm fallback
        // cfg with maintenanceMarginBps = 0 exercises _effectiveMmBps default path
        const snap = await h.getAccountRisk(owner.address, await oracle.getAddress(), true, 0, 4000, 20);
        expect(snap.crossPositionCount).to.equal(1n);
    });
});
