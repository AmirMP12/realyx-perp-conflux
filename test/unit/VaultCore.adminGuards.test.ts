import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE } from "../helpers/constants";

const market = "0x00000000000000000000000000000000000000B7";

// Fresh: tokens minted/approved, TRADING_CORE_ROLE granted to a spare EOA, but
// NO LP deposit and NO insurance stake. `alice` deliberately holds no vault
// roles so she can drive the unauthorized side of every role-gated entrypoint.
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

// ───────────────────────────────────────────────────────────────────────────
// Access-control: the UNAUTHORIZED side of every role-gated entrypoint. These
// verify the revert NotX() guard of each function's role modifier — the side
// the happy-path tests never exercise.
// ───────────────────────────────────────────────────────────────────────────
describe("VaultCore — onlyAdmin unauthorized reverts", () => {
    it("setTradingCore rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).setTradingCore(d.bob.address)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("proposeTradingCore rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).proposeTradingCore(d.bob.address)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("setTreasury rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).setTreasury(d.bob.address)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("proposeTreasury rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).proposeTreasury(d.bob.address)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("setThresholds rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).setThresholds(8000, 9500)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("setMaxProtocolTVL rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).setMaxProtocolTVL(usdc(1))).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("setMaxWithdrawalsPerUser rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).setMaxWithdrawalsPerUser(3)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("setMinInitialInsuranceDeposit rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.alice).setMinInitialInsuranceDeposit(usdc(500)),
        ).to.be.revertedWithCustomError(d.vault, "NotAdmin");
    });
    it("resetInsuranceCircuitBreaker rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).resetInsuranceCircuitBreaker()).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("sweepDonations rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).sweepDonations(0, 0, 0)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("setSwapRouterAllowed rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.alice).setSwapRouterAllowed(d.bob.address, true),
        ).to.be.revertedWithCustomError(d.vault, "NotAdmin");
    });
    it("setMinSwapSlippageBps rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).setMinSwapSlippageBps(10)).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
    it("stopEmergencyMode rejects a non-admin caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).stopEmergencyMode()).to.be.revertedWithCustomError(
            d.vault,
            "NotAdmin",
        );
    });
});

describe("VaultCore — onlyTradingCore unauthorized reverts", () => {
    it("borrow rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).borrow(usdc(1), market, true)).to.be.revertedWithCustomError(
            d.vault,
            "NotTradingCore",
        );
    });
    it("repay rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).repay(usdc(1), market, true, 0)).to.be.revertedWithCustomError(
            d.vault,
            "NotTradingCore",
        );
    });
    it("updateExposure rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.alice).updateExposure(market, usdc(1), true),
        ).to.be.revertedWithCustomError(d.vault, "NotTradingCore");
    });
    it("coverBadDebt rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).coverBadDebt(usdc(1), 1)).to.be.revertedWithCustomError(
            d.vault,
            "NotTradingCore",
        );
    });
    it("submitClaim rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).submitClaim(usdc(1), 1)).to.be.revertedWithCustomError(
            d.vault,
            "NotTradingCore",
        );
    });
    it("receiveFees rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).receiveFees(usdc(1))).to.be.revertedWithCustomError(
            d.vault,
            "NotTradingCore",
        );
    });
    it("receiveLpFees rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).receiveLpFees(usdc(1))).to.be.revertedWithCustomError(
            d.vault,
            "NotTradingCore",
        );
    });
    it("accrueRebate rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).accrueRebate(d.bob.address, usdc(1))).to.be.revertedWithCustomError(
            d.vault,
            "NotTradingCore",
        );
    });
    it("repayWithCollateral rejects a caller without TRADING_CORE_ROLE", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.alice).repayWithCollateral(usdc(1), market, true, 0, d.bob.address, 1),
        ).to.be.revertedWithCustomError(d.vault, "NotTradingCore");
    });
});

describe("VaultCore — onlyOperator / onlyGuardian unauthorized reverts", () => {
    it("setMaxExposure rejects a non-operator caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).setMaxExposure(market, 3000)).to.be.revertedWithCustomError(
            d.vault,
            "NotOperator",
        );
    });
    it("updateProtocolTVL rejects a non-operator caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).updateProtocolTVL(usdc(1))).to.be.revertedWithCustomError(
            d.vault,
            "NotOperator",
        );
    });
    it("swapCollateralToUsdc rejects a non-operator caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.alice).swapCollateralToUsdc(d.bob.address, 1, 0, d.bob.address, "0x"),
        ).to.be.revertedWithCustomError(d.vault, "NotOperator");
    });
    it("triggerEmergencyMode rejects a non-guardian caller", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).triggerEmergencyMode()).to.be.revertedWithCustomError(
            d.vault,
            "NotGuardian",
        );
    });
    it("approveClaim rejects a non-guardian caller", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 1);
        await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 1);
        await expect(d.vault.connect(d.alice).approveClaim(claimId)).to.be.revertedWithCustomError(
            d.vault,
            "NotGuardian",
        );
    });
});

// ───────────────────────────────────────────────────────────────────────────
// whenNotPaused: the paused side of the modifier for the LP-facing entrypoints.
// ───────────────────────────────────────────────────────────────────────────
describe("VaultCore — whenNotPaused reverts when paused", () => {
    it("deposit reverts while the vault is paused", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).pause();
        await expect(
            d.vault.connect(d.alice).deposit(usdc(1_000), d.alice.address),
        ).to.be.revertedWithCustomError(d.vault, "EnforcedPause");
    });
    it("withdraw reverts while the vault is paused", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await d.vault.connect(d.guardian).pause();
        await expect(
            d.vault.connect(d.lp).withdraw(sh / 10n, d.lp.address, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "EnforcedPause");
    });
    it("stakeInsurance reverts while the vault is paused", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).pause();
        await expect(
            d.vault.connect(d.lp).stakeInsurance(usdc(1_000), d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "EnforcedPause");
    });
    it("distributeSurplus reverts while the vault is paused", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).pause();
        await expect(d.vault.distributeSurplus()).to.be.revertedWithCustomError(d.vault, "EnforcedPause");
    });
    it("unpause restores normal deposits", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.guardian).pause();
        await d.vault.connect(d.admin).unpause();
        await expect(d.vault.connect(d.alice).deposit(usdc(1_000), d.alice.address)).to.emit(d.vault, "Deposit");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// deposit input guards + receiver routing
// ───────────────────────────────────────────────────────────────────────────
describe("VaultCore — deposit guards & receiver routing", () => {
    it("deposit reverts on zero assets", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.alice).deposit(0, d.alice.address)).to.be.revertedWithCustomError(
            d.vault,
            "ZeroAssets",
        );
    });
    it("deposit reverts on a zero-address receiver", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.alice).deposit(usdc(1_000), ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(d.vault, "ZeroAddress");
    });
    it("deposit credits shares to a receiver other than the caller", async () => {
        const { d } = await loadFixture(fundedVault);
        const before = await d.vault.lpBalanceOf(d.bob.address);
        await d.vault.connect(d.alice).deposit(usdc(1_000_000), d.bob.address);
        expect(await d.vault.lpBalanceOf(d.bob.address)).to.be.greaterThan(before);
        // caller alice was not credited
        expect(await d.vault.lpBalanceOf(d.alice.address)).to.equal(0n);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// withdraw / queueWithdrawal guards
// ───────────────────────────────────────────────────────────────────────────
describe("VaultCore — withdraw / queue guards", () => {
    it("instant withdraw routes assets to a receiver other than the owner/caller", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        const before = await d.usdt0.balanceOf(d.bob.address);
        await expect(d.vault.connect(d.lp).withdraw(sh / 10n, d.bob.address, d.lp.address)).to.emit(
            d.vault,
            "Withdraw",
        );
        expect(await d.usdt0.balanceOf(d.bob.address)).to.be.greaterThan(before);
    });
    it("queueWithdrawal reverts on zero shares", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.lp).queueWithdrawal(0, 0)).to.be.revertedWithCustomError(
            d.vault,
            "ZeroShares",
        );
    });
    it("queueWithdrawal reverts on insufficient shares", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await expect(d.vault.connect(d.lp).queueWithdrawal(sh + 1n, 0)).to.be.revertedWithCustomError(
            d.vault,
            "InsufficientShares",
        );
    });
    it("queueWithdrawal allows unlimited requests when the per-user cap is 0", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.admin).setMaxWithdrawalsPerUser(0);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        // default cap is 10; with the cap disabled, 12 queued requests all succeed
        for (let i = 0; i < 12; i++) {
            await d.vault.connect(d.lp).queueWithdrawal(sh / 1000n, 0);
        }
        const req = await d.vault.getWithdrawalRequest(12);
        expect(req.user).to.equal(d.lp.address);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// insurance stake/unstake
// ───────────────────────────────────────────────────────────────────────────
describe("VaultCore — insurance stake/unstake", () => {
    it("a second insurance stake is priced against the existing pool (insAssets > 0)", async () => {
        const { d } = await loadFixture(fundedVault);
        // alice stakes after the pool already holds insurance -> the
        // (assets * insTotalShares / insAssets) path of _convertToInsShares.
        const before = await d.vault.insBalanceOf(d.alice.address);
        await d.vault.connect(d.alice).stakeInsurance(usdc(500_000), d.alice.address);
        expect(await d.vault.insBalanceOf(d.alice.address)).to.be.greaterThan(before);
    });

    it("stakeInsurance credits a receiver other than the caller", async () => {
        const { d } = await loadFixture(fundedVault);
        const before = await d.vault.insBalanceOf(d.bob.address);
        await d.vault.connect(d.alice).stakeInsurance(usdc(300_000), d.bob.address);
        expect(await d.vault.insBalanceOf(d.bob.address)).to.be.greaterThan(before);
    });

    it("unstake caps the payout at the request-time snapshot when share price has risen", async () => {
        const { d } = await loadFixture(fundedVault);
        // Stake more so a partial unstake comfortably clears the min ratio.
        await d.vault.connect(d.lp).stakeInsurance(usdc(3_000_000), d.lp.address);
        await d.vault.connect(d.lp).requestUnstake();
        // Raise insurance assets WITHOUT minting shares (donation swept into the
        // insurance slice) so live per-share value exceeds the snapshot.
        await d.usdt0.connect(d.alice).transfer(await d.vault.getAddress(), usdc(500_000));
        await d.vault.recordDonation();
        await d.vault.connect(d.admin).sweepDonations(0, usdc(500_000), 0);
        await time.increase(7 * 24 * 60 * 60 + 1);
        const sh = await d.vault.insBalanceOf(d.lp.address);
        const before = await d.usdt0.balanceOf(d.lp.address);
        await expect(d.vault.connect(d.lp).unstakeInsurance(sh / 50n, d.lp.address)).to.emit(
            d.vault,
            "InsuranceUnstaked",
        );
        expect(await d.usdt0.balanceOf(d.lp.address)).to.be.greaterThan(before);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// repay PnL accounting
// ───────────────────────────────────────────────────────────────────────────
describe("VaultCore — repay PnL accounting", () => {
    it("repay with profit exceeding principal reduces the LP cash counter", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
        const lpBefore = await d.vault.lpAssets();
        // pnl (profit) larger than the principal returned -> net USDC leaves the
        // vault, exercising the receiveAmount < sentOut outflow.
        await d.vault.connect(coreEoa).repay(usdc(100_000), market, true, usdc(300_000));
        expect(await d.vault.lpAssets()).to.be.lessThan(lpBefore);
        expect(await d.vault.totalBorrowed()).to.equal(0n);
    });

    it("repay with zero pnl returns principal and leaves LP cash unchanged net of repay", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
        const lpBefore = await d.vault.lpAssets();
        await d.vault.connect(coreEoa).repay(usdc(100_000), market, true, 0);
        // principal flows back in, nothing paid out -> LP counter restored
        expect(await d.vault.lpAssets()).to.equal(lpBefore + usdc(100_000));
    });
});

// ───────────────────────────────────────────────────────────────────────────
// claims, surplus, donations, threshold-setter guards
// ───────────────────────────────────────────────────────────────────────────
describe("VaultCore — claims / surplus / donations / setters", () => {
    it("coverBadDebt at exactly the approval threshold takes the auto-paid path", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        // amount == approvalThreshold (10_000e6): `amount > approvalThreshold`
        // is false, so it records a fully-paid auto claim rather than a
        // governance claim.
        await d.vault.connect(coreEoa).coverBadDebt(usdc(10_000), 21);
        const claim = await d.vault.getClaim(1);
        expect(claim.amountPaid).to.equal(usdc(10_000));
        expect(claim.paid).to.equal(true);
    });

    it("a governance claim is paid in two stages once insurance is topped up", async () => {
        // Build a vault with a deliberately SMALL insurance pool so a single
        // claim exceeds available insurance (forcing a partial payment) while
        // total payouts stay under the per-window claim budget (100k USDC).
        const { d, coreEoa } = await loadFixture(freshVault);
        await d.vault.connect(d.lp).deposit(usdc(5_000_000), d.lp.address);
        await d.vault.connect(d.lp).stakeInsurance(usdc(20_000), d.lp.address);

        // 50k > approvalThreshold (10k) -> governance claim (not auto-approved).
        const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 22);
        await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 22);
        await d.vault.connect(d.guardian).approveClaim(claimId);

        // First pass: only 20k insurance available -> partial payment.
        await d.vault.processClaim(claimId);
        let claim = await d.vault.getClaim(claimId);
        expect(claim.paid).to.equal(false);
        expect(claim.amountPaid).to.equal(usdc(20_000));

        // Top up insurance, process again -> the remaining 30k is paid in full.
        await d.vault.connect(d.lp).stakeInsurance(usdc(40_000), d.lp.address);
        await d.vault.processClaim(claimId);
        claim = await d.vault.getClaim(claimId);
        expect(claim.paid).to.equal(true);
        expect(claim.amountPaid).to.equal(usdc(50_000));
    });

    it("processClaim reverts for an unknown claim id (not approved)", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.processClaim(7777)).to.be.revertedWithCustomError(d.vault, "ClaimNotApproved");
    });

    it("receiveLpFees credits the LP slice and lifts the share price", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        const priceBefore = await d.vault.getLPSharePrice();
        await d.vault.connect(coreEoa).receiveLpFees(usdc(100_000));
        expect(await d.vault.lpAssets()).to.be.greaterThan(0n);
        expect(await d.vault.getLPSharePrice()).to.be.greaterThan(priceBefore);
    });

    it("sweepDonations routes a donation entirely into the insurance slice", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.usdt0.connect(d.alice).transfer(await d.vault.getAddress(), usdc(7_000));
        await d.vault.recordDonation();
        const insBefore = await d.vault.insuranceAssets();
        await d.vault.connect(d.admin).sweepDonations(0, usdc(7_000), 0);
        expect(await d.vault.insuranceAssets()).to.equal(insBefore + usdc(7_000));
        expect(await d.vault.donatedAssets()).to.equal(0n);
    });

    it("setThresholds reverts when restriction >= emergency", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.admin).setThresholds(9000, 9000)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });

    it("setThresholds reverts when emergency exceeds BPS", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.admin).setThresholds(7000, 10001)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });

    it("setThresholds reverts when restriction is zero", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.admin).setThresholds(0, 9000)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });
});
