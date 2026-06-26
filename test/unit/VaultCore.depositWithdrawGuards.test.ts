import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE } from "../helpers/constants";

const market = "0x00000000000000000000000000000000000000B7";

// Tokens minted + approved for everyone, TRADING_CORE_ROLE on a fresh EOA, but
// NO LP deposit and NO insurance stake yet (so first-deposit / tvl==0 cases
// can be exercised).
async function freshVault() {
    const d = await deployProtocol();
    const [, , , , , , , , , , , coreEoa] = d.signers;
    await d.vault.connect(d.admin).grantRole(TRADING_CORE_ROLE, coreEoa.address);
    for (const s of [d.lp, d.alice, d.bob, coreEoa]) {
        await d.usdt0.mintTo(s.address, usdc(50_000_000));
        await d.usdt0.connect(s).approve(await d.vault.getAddress(), ethers.MaxUint256);
    }
    return { d, coreEoa };
}

async function fundedVault() {
    const { d, coreEoa } = await freshVault();
    await d.vault.connect(d.lp).deposit(usdc(5_000_000), d.lp.address);
    await d.vault.connect(d.lp).stakeInsurance(usdc(1_000_000), d.lp.address);
    return { d, coreEoa };
}

function reqIdFrom(d: any, rc: any): bigint {
    return rc!.logs
        .map((l: any) => {
            try {
                return d.vault.interface.parseLog(l);
            } catch {
                return null;
            }
        })
        .find((p: any) => p && p.name === "WithdrawalQueued")!.args[2];
}

describe("VaultCore — deposit and withdraw guards", () => {
    it("deposit reverts while emergency mode is active (notEmergencyMode modifier)", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        await expect(
            d.vault.connect(d.alice).deposit(usdc(1_000), d.alice.address),
        ).to.be.revertedWithCustomError(d.vault, "EmergencyModeActive");
    });

    it("instant withdraw reverts with NotOwner when owner != caller", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        // alice calls but names lp as owner -> NotOwner (after the share check passes)
        await expect(
            d.vault.connect(d.alice).withdraw(sh / 10n, d.alice.address, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "NotOwner");
    });

    it("instant withdraw reverts with EmergencyModeActive", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        await expect(
            d.vault.connect(d.lp).withdraw(sh / 10n, d.lp.address, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "EmergencyModeActive");
    });

    it("instant withdraw happy path burns shares and emits Withdraw", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        const before = await d.usdt0.balanceOf(d.lp.address);
        await expect(d.vault.connect(d.lp).withdraw(sh / 10n, d.lp.address, d.lp.address)).to.emit(
            d.vault,
            "Withdraw",
        );
        expect(await d.vault.lpBalanceOf(d.lp.address)).to.be.lessThan(sh);
        expect(await d.usdt0.balanceOf(d.lp.address)).to.be.greaterThan(before);
    });
});

describe("VaultCore — queue cancellation", () => {
    it("cancelQueuedWithdrawal returns shares and releases the reservation", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 4n, 0);
        const reqId = reqIdFrom(d, await tx.wait());
        // shares were moved out of the LP balance and liquidity reserved
        expect(await d.vault.lpBalanceOf(d.lp.address)).to.equal(sh - sh / 4n);
        expect(await d.vault.reservedLiquidity()).to.be.greaterThan(0n);
        await expect(d.vault.connect(d.lp).cancelQueuedWithdrawal(reqId)).to.emit(d.vault, "WithdrawalCancelled");
        expect(await d.vault.lpBalanceOf(d.lp.address)).to.equal(sh);
        expect(await d.vault.reservedLiquidity()).to.equal(0n);
    });

    it("cancelQueuedWithdrawal reverts with InvalidRequest for an already-processed request", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 4n, 0);
        const reqId = reqIdFrom(d, await tx.wait());
        await time.increase(24 * 60 * 60 + 1);
        await d.vault.processWithdrawals([reqId]);
        // request is processed (user still set) -> InvalidRequest, not NotOwner
        await expect(d.vault.connect(d.lp).cancelQueuedWithdrawal(reqId)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });
});

describe("VaultCore — insurance stake/unstake guards", () => {
    it("first insurance stake below the minimum reverts", async () => {
        const { d } = await loadFixture(freshVault);
        await expect(
            d.vault.connect(d.lp).stakeInsurance(usdc(999), d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "MinimumInsuranceDepositRequired");
    });

    it("unstakeInsurance reverts with CooldownNotStarted when no request exists", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.insBalanceOf(d.lp.address);
        await expect(
            d.vault.connect(d.lp).unstakeInsurance(sh / 10n, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "CooldownNotStarted");
    });

    it("unstakeInsurance reverts with CooldownNotComplete before the cooldown elapses", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.insBalanceOf(d.lp.address);
        await d.vault.connect(d.lp).requestUnstake();
        // no time advanced -> cooldown not complete
        await expect(
            d.vault.connect(d.lp).unstakeInsurance(sh / 10n, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "CooldownNotComplete");
    });

    it("cancelUnstakeRequest reverts when no request is active", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.lp).cancelUnstakeRequest()).to.be.revertedWithCustomError(
            d.vault,
            "CooldownNotStarted",
        );
    });

    it("cancelUnstakeRequest clears an active request", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.lp).requestUnstake();
        expect(await d.vault.unstakeRequestTime(d.lp.address)).to.be.greaterThan(0n);
        await d.vault.connect(d.lp).cancelUnstakeRequest();
        expect(await d.vault.unstakeRequestTime(d.lp.address)).to.equal(0n);
    });
});

describe("VaultCore — emergency mode", () => {
    it("triggerEmergencyMode is idempotent (second call is a no-op)", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        const activatedAt = await d.vault.emergencyModeActivatedAt();
        await time.increase(10);
        // calling again must not re-emit / reset the timestamp
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        expect(await d.vault.emergencyModeActivatedAt()).to.equal(activatedAt);
        expect(await d.vault.isEmergencyMode()).to.equal(true);
    });

    it("stopEmergencyMode clears the flag when utilization is below the restriction threshold", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        // no borrows -> utilization 0 -> stop succeeds
        await expect(d.vault.connect(d.admin).stopEmergencyMode()).to.emit(d.vault, "EmergencyModeDeactivated");
        expect(await d.vault.isEmergencyMode()).to.equal(false);
        expect(await d.vault.emergencyModeActivatedAt()).to.equal(0n);
    });

    it("emergencyEscapeWithdraw reverts with NotEmergencyMode when not in emergency", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await expect(
            d.vault.connect(d.lp).emergencyEscapeWithdraw(sh / 10n),
        ).to.be.revertedWithCustomError(d.vault, "NotEmergencyMode");
    });

    it("emergencyEscapeWithdraw reverts before the escape timelock expires", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await expect(
            d.vault.connect(d.lp).emergencyEscapeWithdraw(sh / 10n),
        ).to.be.revertedWithCustomError(d.vault, "EscapeTimelockNotExpired");
    });

    it("emergencyEscapeWithdraw pays out in full when liquidity is sufficient (no cap)", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        await time.increase(7 * 24 * 60 * 60 + 1);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        const before = await d.usdt0.balanceOf(d.lp.address);
        // ample on-hand liquidity -> requestedAssets <= available, no capping event
        await expect(d.vault.connect(d.lp).emergencyEscapeWithdraw(sh / 10n)).to.emit(d.vault, "Withdraw");
        expect(await d.usdt0.balanceOf(d.lp.address)).to.be.greaterThan(before);
    });
});

describe("VaultCore — treasury rotation + deprecated entrypoints", () => {
    it("setTreasury reverts with PendingTreasuryMismatch without a staged proposal", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.admin).setTreasury(d.bob.address)).to.be.revertedWithCustomError(
            d.vault,
            "PendingTreasuryMismatch",
        );
    });

    it("setTreasury reverts with TreasuryTimelockActive immediately after proposing", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.admin).proposeTreasury(d.bob.address);
        await expect(d.vault.connect(d.admin).setTreasury(d.bob.address)).to.be.revertedWithCustomError(
            d.vault,
            "TreasuryTimelockActive",
        );
    });

    it("setTreasury rotates the treasury after the 48h timelock", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.admin).proposeTreasury(d.bob.address);
        await time.increase(48 * 60 * 60 + 1);
        await expect(d.vault.connect(d.admin).setTreasury(d.bob.address)).to.emit(d.vault, "TreasuryUpdated");
        expect(await d.vault.treasury()).to.equal(d.bob.address);
        const [pending, effective] = await d.vault.pendingTreasury();
        expect(pending).to.equal(ethers.ZeroAddress);
        expect(effective).to.equal(0n);
    });

    it("updateProtocolTVL is deprecated and reverts", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.operator).updateProtocolTVL(usdc(1_000))).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });

    it("repayWithCollateral is disabled and reverts", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(coreEoa).repayWithCollateral(usdc(1), market, true, 0, d.bob.address, 1),
        ).to.be.revertedWithCustomError(d.vault, "InvalidRequest");
    });
});

describe("VaultCore — views on an empty vault", () => {
    it("getInsuranceHealthRatio returns PRECISION and isInsuranceHealthy is true when TVL is zero", async () => {
        const { d } = await loadFixture(freshVault);
        expect(await d.vault.getProtocolTVL()).to.equal(0n);
        expect(await d.vault.getInsuranceHealthRatio()).to.equal(ethers.parseUnits("1", 18));
        expect(await d.vault.isInsuranceHealthy()).to.equal(true);
    });

    it("getUtilization and getConservativeUtilization are zero on an empty vault", async () => {
        const { d } = await loadFixture(freshVault);
        expect(await d.vault.getUtilization()).to.equal(0n);
        expect(await d.vault.getConservativeUtilization()).to.equal(0n);
        expect(await d.vault.getAvailableLiquidity()).to.equal(0n);
    });
});

describe("VaultCore — setTradingCore rotation revoke path", () => {
    it("rotating TradingCore revokes the role from the old core and grants it to the new one", async () => {
        const { d } = await loadFixture(fundedVault);
        const oldCore = await d.vault.tradingCore();
        await d.vault.connect(d.admin).proposeTradingCore(d.bob.address);
        await time.increase(48 * 60 * 60 + 1);
        await d.vault.connect(d.admin).setTradingCore(d.bob.address);
        expect(await d.vault.tradingCore()).to.equal(d.bob.address);
        // old core lost the role, new core gained it
        expect(await d.vault.hasRole(TRADING_CORE_ROLE, oldCore)).to.equal(false);
        expect(await d.vault.hasRole(TRADING_CORE_ROLE, d.bob.address)).to.equal(true);
        // pending cleared
        const [pending, effective] = await d.vault.pendingTradingCore();
        expect(pending).to.equal(ethers.ZeroAddress);
        expect(effective).to.equal(0n);
    });
});

describe("VaultCore — _processWithdrawalExt self-call guard", () => {
    it("_processWithdrawalExt reverts with InvalidRequest when called externally (not self)", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.lp)._processWithdrawalExt(1)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });
});

describe("VaultCore — distributeSurplus surplus-capped-to-fees", () => {
    it("caps the distributed surplus by accumulatedFees and emits SurplusDistributed", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        // Push insurance well above target by staking a lot, then accrue a small
        // fee. Surplus (insurance above target) far exceeds fees, so the payout
        // is capped at accumulatedFees.
        await d.vault.connect(d.lp).stakeInsurance(usdc(3_000_000), d.lp.address);
        await d.vault.connect(coreEoa).receiveFees(usdc(50_000));
        const feesBefore = await d.vault.accumulatedFees();
        await expect(d.vault.distributeSurplus()).to.emit(d.vault, "SurplusDistributed");
        // all (or capped portion of) fees consumed
        expect(await d.vault.accumulatedFees()).to.be.lessThan(feesBefore);
    });
});

describe("VaultCore — full insurance unstake after cooldown", () => {
    it("unstakes a healthy partial amount and emits InsuranceUnstaked", async () => {
        const { d } = await loadFixture(fundedVault);
        // add more insurance so a partial unstake stays above the min ratio
        await d.vault.connect(d.lp).stakeInsurance(usdc(3_000_000), d.lp.address);
        const sh = await d.vault.insBalanceOf(d.lp.address);
        await d.vault.connect(d.lp).requestUnstake();
        await time.increase(7 * 24 * 60 * 60 + 1);
        const before = await d.usdt0.balanceOf(d.lp.address);
        await expect(d.vault.connect(d.lp).unstakeInsurance(sh / 20n, d.lp.address)).to.emit(
            d.vault,
            "InsuranceUnstaked",
        );
        expect(await d.usdt0.balanceOf(d.lp.address)).to.be.greaterThan(before);
        // request cleared after a successful unstake
        expect(await d.vault.unstakeRequestTime(d.lp.address)).to.equal(0n);
    });
});

describe("VaultCore — sweepDonations partial splits", () => {
    it("records a donation then sweeps only into the LP slice (toInsurance/toTreasury = 0)", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.usdt0.connect(d.alice).transfer(await d.vault.getAddress(), usdc(8_000));
        await d.vault.recordDonation();
        expect(await d.vault.donatedAssets()).to.equal(usdc(8_000));
        const lpBefore = await d.vault.lpAssets();
        await d.vault.connect(d.admin).sweepDonations(usdc(8_000), 0, 0);
        expect(await d.vault.donatedAssets()).to.equal(0n);
        expect(await d.vault.lpAssets()).to.equal(lpBefore + usdc(8_000));
    });

    it("sweeps a donation entirely to treasury", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.usdt0.connect(d.alice).transfer(await d.vault.getAddress(), usdc(6_000));
        await d.vault.recordDonation();
        const treasuryBefore = await d.usdt0.balanceOf(d.treasury.address);
        await d.vault.connect(d.admin).sweepDonations(0, 0, usdc(6_000));
        expect(await d.usdt0.balanceOf(d.treasury.address)).to.equal(treasuryBefore + usdc(6_000));
        expect(await d.vault.donatedAssets()).to.equal(0n);
    });
});

describe("VaultCore — claim rate-limiting", () => {
    it("processClaim reverts with ClaimRateLimitExceeded once the window budget is exhausted", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        // Stake enough insurance so payouts are bounded by claim amount, not by
        // available assets. maxClaimsPerWindow defaults to 100k.
        await d.vault.connect(d.lp).stakeInsurance(usdc(4_000_000), d.lp.address);
        // First claim primes the leaky-bucket (the very first rate-limit call
        // only initialises state and never reverts).
        const id1 = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(80_000), 1);
        await d.vault.connect(coreEoa).submitClaim(usdc(80_000), 1);
        await d.vault.connect(d.guardian).approveClaim(id1);
        await d.vault.processClaim(id1);
        // Second claim's payout pushes the bucket above maxClaimsPerWindow.
        const id2 = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(80_000), 2);
        await d.vault.connect(coreEoa).submitClaim(usdc(80_000), 2);
        await d.vault.connect(d.guardian).approveClaim(id2);
        await expect(d.vault.processClaim(id2)).to.be.revertedWithCustomError(
            d.vault,
            "ClaimRateLimitExceeded",
        );
    });

    it("processClaim pays in full and marks the claim paid when within the window budget", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.lp).stakeInsurance(usdc(4_000_000), d.lp.address);
        const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 7);
        await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 7);
        await d.vault.connect(d.guardian).approveClaim(claimId);
        await d.vault.processClaim(claimId);
        const claim = await d.vault.getClaim(claimId);
        expect(claim.paid).to.equal(true);
        expect(claim.amountPaid).to.equal(usdc(50_000));
    });
});
