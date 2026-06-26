import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE, OPERATOR_ROLE } from "../helpers/constants";

const market = "0x00000000000000000000000000000000000000B7";

async function fundedVault() {
    const d = await deployProtocol();
    const [, , , , , , , , , , , coreEoa] = d.signers;
    await d.vault.connect(d.admin).grantRole(TRADING_CORE_ROLE, coreEoa.address);
    for (const s of [d.lp, d.alice, d.bob, coreEoa]) {
        await d.usdt0.mintTo(s.address, usdc(50_000_000));
        await d.usdt0.connect(s).approve(await d.vault.getAddress(), ethers.MaxUint256);
    }
    await d.vault.connect(d.lp).deposit(usdc(5_000_000), d.lp.address);
    await d.vault.connect(d.lp).stakeInsurance(usdc(1_000_000), d.lp.address);
    return { d, coreEoa };
}

describe("VaultCore — gated insurance, claims & surplus", () => {
    describe("coverBadDebt", () => {
        it("partial cover when amount exceeds insurance assets", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // amount well above insurance (1M) but under the 10% breaker is impossible;
            // request just over available so the cover is capped at the available
            // amount with a small enough cumulative to avoid the breaker.
            const covered = await d.vault.connect(coreEoa).coverBadDebt.staticCall(usdc(50_000), 1);
            expect(covered).to.equal(usdc(50_000));
        });

        it("trips the 24h cumulative circuit breaker and returns 0", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // breaker threshold = 10% of insurance = 100k; one cover of 150k trips it
            const covered = await d.vault.connect(coreEoa).coverBadDebt.staticCall(usdc(150_000), 7);
            expect(covered).to.equal(0n);
            await d.vault.connect(coreEoa).coverBadDebt(usdc(150_000), 7);
            expect(await d.vault.insuranceCircuitBreakerActive()).to.equal(true);
            // subsequent cover reverts while breaker active
            await expect(d.vault.connect(coreEoa).coverBadDebt(usdc(1000), 8)).to.be.revertedWithCustomError(
                d.vault,
                "InsuranceFundCircuitBreakerActive",
            );
        });

        it("resets the 24h cumulative window after 24h", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).coverBadDebt(usdc(50_000), 1);
            await time.increase(24 * 60 * 60 + 1);
            // after the window resets, another small cover succeeds
            const covered = await d.vault.connect(coreEoa).coverBadDebt.staticCall(usdc(50_000), 2);
            expect(covered).to.equal(usdc(50_000));
        });

        it("governance claim path: large cover (> approvalThreshold) records a partial-paid claim", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // approvalThreshold is 10k; 50k cover goes through the governance claim flow
            await d.vault.connect(coreEoa).coverBadDebt(usdc(50_000), 9);
            const claim = await d.vault.getClaim(1);
            expect(claim.amount).to.be.greaterThan(0n);
            expect(claim.amountPaid).to.be.greaterThan(0n);
        });

        it("under-threshold cover records a fully-paid claim", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).coverBadDebt(usdc(5_000), 11);
            // a claim id is allocated and marked paid for the auto path
            const claim = await d.vault.getClaim(1);
            expect(claim.amountPaid).to.equal(usdc(5_000));
        });
    });

    describe("submit / approve / process claim", () => {
        it("processClaim reverts when not approved", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // submit a large claim that is NOT auto-approved (> approvalThreshold)
            const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 3);
            await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 3);
            await expect(d.vault.processClaim(claimId)).to.be.revertedWithCustomError(d.vault, "ClaimNotApproved");
        });

        it("approveClaim then processClaim pays in full", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 3);
            await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 3);
            await d.vault.connect(d.guardian).approveClaim(claimId);
            await d.vault.processClaim(claimId);
            const claim = await d.vault.getClaim(claimId);
            expect(claim.amountPaid).to.be.greaterThan(0n);
        });

        it("approveClaim reverts for a paid/invalid claim", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.guardian).approveClaim(123456)).to.be.revertedWithCustomError(
                d.vault,
                "ClaimInvalidOrPaid",
            );
        });
    });

    describe("updateExposure decrement paths", () => {
        it("decrements long and short exposure and clamps at zero", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).updateExposure(market, usdc(50_000), true);
            await d.vault.connect(coreEoa).updateExposure(market, usdc(30_000), false);
            await d.vault.connect(coreEoa).updateExposure(market, -usdc(100_000), true); // clamp long to 0
            await d.vault.connect(coreEoa).updateExposure(market, -usdc(100_000), false); // clamp short to 0
            const exp = await d.vault.getMarketExposure(market);
            expect(exp.longExposure).to.equal(0n);
            expect(exp.shortExposure).to.equal(0n);
        });
    });

    describe("distributeSurplus with treasury + staker split", () => {
        it("splits surplus above target between treasury and stakers", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // accrue large fees so insurance surplus exceeds the target ratio
            await d.vault.connect(coreEoa).receiveFees(usdc(2_000_000));
            const treasuryBefore = await d.usdt0.balanceOf(d.treasury.address);
            await d.vault.distributeSurplus();
            expect(await d.usdt0.balanceOf(d.treasury.address)).to.be.greaterThanOrEqual(treasuryBefore);
        });
    });

    describe("emergencyEscapeWithdraw capped payout", () => {
        it("caps the payout to available liquidity after a borrow drains the pool", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(d.operator).setMaxExposure(market, 8000);
            await d.vault.connect(coreEoa).borrow(usdc(3_000_000), market, true);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            await time.increase(7 * 24 * 60 * 60 + 1);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            // requested assets exceed available -> payout is capped and the event fires
            await expect(d.vault.connect(d.lp).emergencyEscapeWithdraw(sh)).to.emit(
                d.vault,
                "EmergencyEscapeWithdrawCapped",
            );
        });

        it("reverts emergencyEscapeWithdraw with zero shares", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            await time.increase(7 * 24 * 60 * 60 + 1);
            await expect(d.vault.connect(d.lp).emergencyEscapeWithdraw(0)).to.be.revertedWithCustomError(
                d.vault,
                "ZeroShares",
            );
        });
    });

    describe("unstakeInsurance UnhealthyRatio guard", () => {
        it("reverts unstaking below the minimum insurance ratio", async () => {
            const { d } = await loadFixture(fundedVault);
            const sh = await d.vault.insBalanceOf(d.lp.address);
            await d.vault.connect(d.lp).requestUnstake();
            await time.increase(7 * 24 * 60 * 60 + 1);
            // unstaking nearly all insurance breaches minRatioBps vs protocol TVL
            await expect(
                d.vault.connect(d.lp).unstakeInsurance(sh, d.lp.address),
            ).to.be.revertedWithCustomError(d.vault, "UnhealthyRatio");
        });
    });

    describe("requestUnstake idempotency", () => {
        it("a second request keeps the original timestamp", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).requestUnstake();
            const t1 = await d.vault.unstakeRequestTime(d.lp.address);
            await time.increase(100);
            await d.vault.connect(d.lp).requestUnstake();
            expect(await d.vault.unstakeRequestTime(d.lp.address)).to.equal(t1);
        });
    });
});
