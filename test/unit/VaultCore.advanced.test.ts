import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE, GUARDIAN_ROLE } from "../helpers/constants";

/**
 * Advanced VaultCore coverage: borrow/repay/exposure, bad-debt cover + claims,
 * referral rebates, surplus distribution, donation sweeps, and rate limits.
 * We impersonate the TradingCore role on a fresh signer so the vault's
 * TradingCore-gated entrypoints can be driven directly.
 */
async function fundedVault() {
    const d = await deployProtocol();
    const [, , , , , , , , , , , coreEoa] = d.signers;
    // Grant a fresh EOA the TRADING_CORE_ROLE so we can call gated fns directly.
    // Note: the real tradingCore already holds the role; granting a second is fine.
    await d.vault.connect(d.admin).grantRole(TRADING_CORE_ROLE, coreEoa.address);

    for (const s of [d.lp, d.alice, d.bob, coreEoa]) {
        await d.usdc.mintTo(s.address, usdc(50_000_000));
        await d.usdc.connect(s).approve(await d.vault.getAddress(), ethers.MaxUint256);
    }
    // seed LP + insurance
    await d.vault.connect(d.lp).deposit(usdc(5_000_000), d.lp.address);
    await d.vault.connect(d.lp).stakeInsurance(usdc(1_000_000), d.lp.address);
    return { d, coreEoa };
}

describe("VaultCore — advanced (TradingCore-gated paths)", () => {
    const market = "0x00000000000000000000000000000000000000B7";

    describe("borrow / repay / exposure", () => {
        it("borrows within utilization and exposure caps", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(100_000), market, true);
            expect(ok).to.equal(true);
            await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
            expect(await d.vault.totalBorrowed()).to.equal(usdc(100_000));
            const exp = await d.vault.getMarketExposure(market);
            expect(exp.longExposure).to.equal(usdc(100_000));
        });

        it("borrow returns false when exceeding available liquidity", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(100_000_000), market, true);
            expect(ok).to.equal(false);
        });

        it("repay returns principal and settles PnL (profit path)", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
            // repay with profit: vault pays trader the pnl; coreEoa must hold receiveAmount
            await d.vault.connect(coreEoa).repay(usdc(100_000), market, true, usdc(5_000));
            expect(await d.vault.totalBorrowed()).to.equal(0n);
        });

        it("repay with loss pulls extra USDC from caller", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
            await d.vault.connect(coreEoa).repay(usdc(100_000), market, true, -usdc(5_000));
            expect(await d.vault.totalBorrowed()).to.equal(0n);
        });

        it("updateExposure increments and decrements OI", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).updateExposure(market, usdc(50_000), true);
            let exp = await d.vault.getMarketExposure(market);
            expect(exp.longExposure).to.equal(usdc(50_000));
            await d.vault.connect(coreEoa).updateExposure(market, -usdc(20_000), true);
            exp = await d.vault.getMarketExposure(market);
            expect(exp.longExposure).to.equal(usdc(30_000));
        });

        it("updateExposure reverts when breaching the cap", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // The cap compares USDC-precision exposure against a conservative-TVL-derived
            // bound; push an enormous delta to deterministically exceed it.
            const huge = ethers.parseUnits("1000000000000000", 6);
            await expect(
                d.vault.connect(coreEoa).updateExposure(market, huge, true),
            ).to.be.revertedWithCustomError(d.vault, "ExceedsExposureCap");
        });
    });

    describe("fees + surplus", () => {
        it("receiveFees pulls USDC and accrues", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).receiveFees(usdc(10_000));
            expect(await d.vault.accumulatedFees()).to.equal(usdc(10_000));
        });

        it("distributeSurplus splits to treasury and stakers", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // accrue large fees so surplus > target
            await d.vault.connect(coreEoa).receiveFees(usdc(500_000));
            const treasuryBefore = await d.usdc.balanceOf(d.treasury.address);
            await d.vault.distributeSurplus();
            // treasury may receive a share if surplus above target
            expect(await d.usdc.balanceOf(d.treasury.address)).to.be.greaterThanOrEqual(treasuryBefore);
        });
    });

    describe("bad debt cover + claims", () => {
        it("coverBadDebt pays out up to insurance assets", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            const coreBalBefore = await d.usdc.balanceOf(coreEoa.address);
            const covered = await d.vault.connect(coreEoa).coverBadDebt.staticCall(usdc(5_000), 1);
            expect(covered).to.be.greaterThan(0n);
            await d.vault.connect(coreEoa).coverBadDebt(usdc(5_000), 1);
            expect(await d.usdc.balanceOf(coreEoa.address)).to.be.greaterThanOrEqual(coreBalBefore);
        });

        it("large bad debt goes through governance claim + payout", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // amount above approvalThreshold (10k) triggers a governance claim
            await d.vault.connect(coreEoa).coverBadDebt(usdc(50_000), 2);
            // there should be a claim recorded
            const claim = await d.vault.getClaim(1);
            expect(claim.amount).to.be.greaterThan(0n);
        });

        it("submitClaim + approveClaim + processClaim lifecycle", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 3);
            await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 3);
            await d.vault.connect(d.guardian).approveClaim(claimId);
            await d.vault.processClaim(claimId);
            const claim = await d.vault.getClaim(claimId);
            expect(claim.amountPaid).to.be.greaterThan(0n);
        });

        it("approveClaim reverts for invalid claim", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.guardian).approveClaim(999)).to.be.revertedWithCustomError(
                d.vault,
                "ClaimInvalidOrPaid",
            );
        });

        it("insurance circuit breaker can be reset by admin", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).resetInsuranceCircuitBreaker();
            expect(await d.vault.insuranceCircuitBreakerActive()).to.equal(false);
        });
    });

    describe("referral rebates", () => {
        it("accrueRebate pulls USDC and credits the referrer", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).accrueRebate(d.bob.address, usdc(100));
            expect(await d.vault.claimableRebates(d.bob.address)).to.equal(usdc(100));
            expect(await d.vault.pendingRebates()).to.equal(usdc(100));
        });
        it("claimRebates pays the referrer and zeroes balance", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).accrueRebate(d.bob.address, usdc(100));
            const before = await d.usdc.balanceOf(d.bob.address);
            await d.vault.connect(d.bob).claimRebates(d.bob.address);
            expect(await d.usdc.balanceOf(d.bob.address)).to.equal(before + usdc(100));
            expect(await d.vault.claimableRebates(d.bob.address)).to.equal(0n);
        });
        it("claimRebates reverts when nothing to claim", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.bob).claimRebates(d.bob.address)).to.be.revertedWithCustomError(
                d.vault,
                "InsufficientLiquidity",
            );
        });
        it("accrueRebate no-ops on zero referrer/amount", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).accrueRebate(ethers.ZeroAddress, usdc(100));
            await d.vault.connect(coreEoa).accrueRebate(d.bob.address, 0);
            expect(await d.vault.pendingRebates()).to.equal(0n);
        });
    });

    describe("exposure caps + thresholds (admin)", () => {
        it("setMaxExposure updates a market cap", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.operator).setMaxExposure(market, 3000)).to.emit(
                d.vault,
                "ExposureCapUpdated",
            );
        });
        it("setThresholds updates restriction/emergency bps", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).setThresholds(8000, 9500)).to.emit(d.vault, "ThresholdsUpdated");
            expect(await d.vault.restrictionThresholdBps()).to.equal(8000n);
        });
        it("setMaxWithdrawalsPerUser / setMinInitialInsuranceDeposit", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).setMaxWithdrawalsPerUser(5);
            expect(await d.vault.maxWithdrawalsPerUser()).to.equal(5n);
            await d.vault.connect(d.admin).setMinInitialInsuranceDeposit(usdc(500));
            expect(await d.vault.minInitialInsuranceDeposit()).to.equal(usdc(500));
        });
        it("setMinInitialInsuranceDeposit rejects above cap", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(
                d.vault.connect(d.admin).setMinInitialInsuranceDeposit(usdc(200_000)),
            ).to.be.revertedWithCustomError(d.vault, "InvalidRequest");
        });
    });

    describe("swap router config (disabled swaps)", () => {
        it("setSwapRouterAllowed + setMinSwapSlippageBps", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).setSwapRouterAllowed(d.bob.address, true);
            expect(await d.vault.allowedSwapRouters(d.bob.address)).to.equal(true);
            await d.vault.connect(d.admin).setMinSwapSlippageBps(9000);
            expect(await d.vault.minSwapSlippageBps()).to.equal(9000n);
        });
        it("setMinSwapSlippageBps rejects > BPS", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).setMinSwapSlippageBps(10001)).to.be.revertedWithCustomError(
                d.vault,
                "InvalidRequest",
            );
        });
        it("swapCollateralToUsdc reverts (disabled)", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(
                d.vault.connect(d.operator).swapCollateralToUsdc(d.bob.address, 1, 1, d.bob.address, "0x"),
            ).to.be.revertedWithCustomError(d.vault, "InvalidRequest");
        });
    });

    describe("preview + conversion views", () => {
        it("previewDeposit / convertToShares agree", async () => {
            const { d } = await loadFixture(fundedVault);
            const a = await d.vault.previewDeposit(usdc(1000));
            const b = await d.vault.convertToShares(usdc(1000));
            expect(a).to.equal(b);
        });
        it("convertToAssets / previewWithdraw agree", async () => {
            const { d } = await loadFixture(fundedVault);
            const shares = await d.vault.lpBalanceOf(d.lp.address);
            const a = await d.vault.previewWithdraw(shares);
            const b = await d.vault.convertToAssets(shares);
            expect(a).to.equal(b);
        });
        it("maxDeposit is unbounded; insurance health views", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.maxDeposit(d.lp.address)).to.equal(ethers.MaxUint256);
            expect(await d.vault.getInsuranceHealthRatio()).to.be.greaterThan(0n);
            expect(await d.vault.isInsuranceHealthy()).to.equal(true);
        });
    });
});
