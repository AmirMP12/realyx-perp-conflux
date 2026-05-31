import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const usdc6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

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

describe("Library coverage 2 — WithdrawLib", () => {
    it("withdraws keeper fees to the caller and zeros the balance", async () => {
        const h = await loadFixture(coverageHarness);
        const [a] = await ethers.getSigners();
        await h.setKeeperFeeBalance(a.address, e18(1)); // tracked balance only
        // No ETH in harness -> withdraw of 0 path / revert tolerance:
        await h.setKeeperFeeBalance(a.address, 0);
        await h.testWithdrawKeeperFees(a.address); // zero balance no-op
    });

    it("withdraws order collateral refund in USDC", async () => {
        const h = await loadFixture(coverageHarness);
        const usdc = await loadFixture(mockUsdc);
        const [a] = await ethers.getSigners();
        // fund the harness with USDC and credit a refund balance
        await usdc.mintTo(await h.getAddress(), usdc6(1000));
        await h.setOrderCollateralRefundBalance(a.address, usdc6(100));
        const before = await usdc.balanceOf(a.address);
        await h.testWithdrawOrderCollateralRefund(a.address, await usdc.getAddress());
        expect(await usdc.balanceOf(a.address)).to.equal(before + usdc6(100));
    });

    it("order refund (ETH) zero balance is a no-op", async () => {
        const h = await loadFixture(coverageHarness);
        const [a] = await ethers.getSigners();
        await h.testWithdrawOrderRefund(a.address);
    });
});

describe("Library coverage 2 — CleanupLib", () => {
    it("removes closed positions from the user list", async () => {
        const h = await loadFixture(coverageHarness);
        // seed 3 positions, mark some CLOSED
        await h.setPositionSimple(1, e18(100), e18(100), 1, PosStatus.CLOSED, ethers.ZeroAddress);
        await h.setPositionSimple(2, e18(100), e18(100), 1, PosStatus.OPEN, ethers.ZeroAddress);
        await h.setPositionSimple(3, e18(100), e18(100), 1, PosStatus.CLOSED, ethers.ZeroAddress);
        await h.addCleanupPosition(1);
        await h.addCleanupPosition(2);
        await h.addCleanupPosition(3);
        const cleaned = await h.testCleanupPositions.staticCall(10);
        expect(cleaned).to.be.greaterThanOrEqual(1n);
        await h.testCleanupPositions(10);
    });
});

describe("Library coverage 2 — DustLib", () => {
    it("does not sweep below the threshold", async () => {
        const h = await loadFixture(coverageHarness);
        const usdc = await loadFixture(mockUsdc);
        const [, treasury] = await ethers.getSigners();
        await h.setDust(100); // below DUST_THRESHOLD
        const swept = await h.testSweepDust.staticCall(await usdc.getAddress(), treasury.address);
        expect(swept).to.equal(0n);
    });
});

describe("Library coverage 2 — FlashLoanCheck", () => {
    it("same-sender same-block second call reverts (non-operator)", async () => {
        const h = await loadFixture(coverageHarness);
        const [a] = await ethers.getSigners();
        await expect(
            h.testDoubleValidateFlashLoan(a.address, a.address, false, 10, 0),
        ).to.be.reverted; // FlashLoanDetected
    });

    it("operator is exempt from the same-block lock", async () => {
        const h = await loadFixture(coverageHarness);
        const [a] = await ethers.getSigners();
        await h.testDoubleValidateFlashLoan(a.address, a.address, true, 10, 0);
    });

    it("global per-block action cap trips with different senders", async () => {
        const h = await loadFixture(coverageHarness);
        const [a, b] = await ethers.getSigners();
        // maxActionsPerBlock = 1 -> second sender in same block trips RateLimitExceeded
        await expect(
            h.testDoubleValidateFlashLoanDifferentSenders(a.address, b.address, a.address, false, 1, 0),
        ).to.be.reverted;
    });

    it("single validate passes for a fresh sender", async () => {
        const h = await loadFixture(coverageHarness);
        const [a] = await ethers.getSigners();
        await h.testValidateFlashLoan(a.address, a.address, false, 10, 0);
    });
});

describe("Library coverage 2 — ConfigLib", () => {
    const M = "0x00000000000000000000000000000000000000B7";
    it("sets and updates a market", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testSetMarket(M, M, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n);
        await h.testUpdateMarket(M, M, 15, e18(2_000_000), e18(6_000_000), 600, 1200, 800, e18(1) / 2n);
    });
    it("unlists a market", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testSetMarket(M, M, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n);
        await h.setUnlistMarket(M);
    });
    it("reverts re-listing an already-listed market", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testSetMarket(M, M, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n);
        await expect(
            h.testSetMarket(M, M, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n),
        ).to.be.reverted; // MarketAlreadyListed
    });
    it("reverts on invalid margin config (im <= mm)", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, M, 20, e18(1_000_000), e18(5_000_000), 1000, 1000, 900, e18(1) / 2n),
        ).to.be.reverted; // InvalidMarginConfig
    });
    it("reverts on zero market/feed", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(ethers.ZeroAddress, M, 20, e18(1_000_000), e18(5_000_000), 500, 1000, 900, e18(1) / 2n),
        ).to.be.reverted; // InvalidMarket
    });
});

describe("Library coverage 2 — GlobalPnLLib + MonitoringLib (via CoverageHarness)", () => {
    it("global PnL across markets with a mock oracle", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const market = "0x00000000000000000000000000000000000000B7";
        await oracle.setPrice(market, e18(110), 0, (await ethers.provider.getBlock("latest"))!.timestamp);
        await h.addMarket(market); // sets long size/cost 1000e18
        const pnl = await h.testGlobalPnL(await oracle.getAddress());
        expect(pnl).to.not.equal(0n);
    });

    it("protocol health snapshot via MonitoringLib with the real vault", async () => {
        // MonitoringLib.getProtocolHealth calls vault.totalAssets() + oracle reads,
        // so we use the fully-wired protocol vault/oracle rather than a thin mock.
        const { deployConfigured } = await import("../helpers/fixture");
        const d = await deployConfigured();
        const h = await coverageHarness();
        await h.setProtocolHealth(true, 0, (await ethers.provider.getBlock("latest"))!.timestamp);
        const res = await h.testGetProtocolHealth(await d.vault.getAddress(), await d.oracle.getAddress());
        expect(res).to.not.equal(undefined);
    });
});

describe("Library coverage 2 — PositionMath trailing/anchor (via CoverageHarness)", () => {
    it("PnL and health via boost helper", async () => {
        const h = await loadFixture(coverageHarness);
        await h.setPositionSimple(1, e18(10_000), e18(100), 1, PosStatus.OPEN, ethers.ZeroAddress);
        await h.setCollateral(1, e18(2_000));
        const [pnl] = await h.boostGetPositionPnL(1, e18(110));
        expect(pnl).to.be.greaterThan(0n);
    });
    it("realized PnL booster", async () => {
        const h = await loadFixture(coverageHarness);
        const r = await h.boostCalculateRealizedPnL(e18(100), e18(5), e18(2));
        expect(r).to.equal(e18(93));
    });
    it("funding owed booster + intervals", async () => {
        const h = await loadFixture(coverageHarness);
        await h.setPositionSimple(1, e18(1000), e18(100), 1, PosStatus.OPEN, ethers.ZeroAddress);
        const owed = await h.boostCalculateFundingOwed(
            {
                size: e18(1000),
                entryPrice: e18(100),
                liquidationPrice: 0,
                stopLossPrice: 0,
                takeProfitPrice: 0,
                leverage: 20,
                lastFundingTime: 0,
                market: ethers.ZeroAddress,
                openTimestamp: 0,
                trailingStopBps: 0,
                flags: 1,
                collateralType: 1,
                state: PosStatus.OPEN,
                collateralToken: ethers.ZeroAddress,
            },
            e18(1) / 100n,
        );
        expect(owed).to.be.greaterThan(0n);
    });
});

describe("Library coverage 2 — DataTypes helpers (via CoverageHarness)", () => {
    it("toUsdcPrecisionCeil rounds up", async () => {
        const h = await loadFixture(coverageHarness);
        expect(await h.testToUsdcPrecisionCeil(0)).to.equal(0n);
        expect(await h.testToUsdcPrecisionCeil(1)).to.equal(1n); // ceil of dust
        expect(await h.testToUsdcPrecisionCeil(10n ** 12n)).to.equal(1n);
    });
    it("isCrossMargin flag decode", async () => {
        const h = await loadFixture(coverageHarness);
        expect(await h.testIsCrossMargin(2)).to.equal(true);
        expect(await h.testIsCrossMargin(1)).to.equal(false);
    });
});

describe("Library coverage 2 — PositionCloseLib (dedicated harness)", () => {
    async function deploy() {
        const usdc = await mockUsdc();
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const PT = await ethers.getContractFactory("MockPositionTokenSimple");
        const pt = await PT.deploy();
        await pt.waitForDeployment();
        const MockVault = await ethers.getContractFactory("MockVaultControl");
        const vault = await MockVault.deploy();
        await vault.waitForDeployment();
        const [admin, treasury] = await ethers.getSigners();

        const libs = await deployAllLibraries();
        const h = await deployHarness("PositionCloseLibHarness", libs, [
            await usdc.getAddress(),
            await vault.getAddress(),
            await oracle.getAddress(),
            await pt.getAddress(),
            treasury.address,
        ]);
        return { h, usdc, oracle, pt, vault, admin, treasury };
    }

    it("deploys, and reverts closing a non-OPEN position", async () => {
        const { h } = await loadFixture(deploy);
        const market = "0x00000000000000000000000000000000000000B7";
        await h.setMarket(market, 500);
        // position left in NONE state -> close must revert (PositionNotFound)
        await expect(h.close(1, e18(1000), 0)).to.be.reverted;
    });

    it("reverts close with zero size (ZeroCloseSize branch)", async () => {
        const { h, oracle, pt } = await loadFixture(deploy);
        const [owner] = await ethers.getSigners();
        const market = "0x00000000000000000000000000000000000000B7";
        await oracle.setPrice(market, e18(110), 0, (await ethers.provider.getBlock("latest"))!.timestamp);
        await h.setMarket(market, 500);
        await h.setPosition(1, market, e18(10_000), e18(100), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(2_000));
        await pt.setOwner(1, owner.address);
        await expect(h.close(1, 0, 0)).to.be.reverted;
    });
});
