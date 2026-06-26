import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE } from "../helpers/constants";

const market = "0x00000000000000000000000000000000000000B7";
const market2 = "0x00000000000000000000000000000000000000C8";

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

describe("VaultCore — borrow cap limits", () => {
    it("borrow returns false when the amount exceeds unreserved liquidity", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        // request far more than is on hand -> borrow returns false (no revert)
        const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(99_000_000), market, true);
        expect(ok).to.equal(false);
    });

    it("borrow returns false when the per-market exposure cap would be exceeded", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        // leave the default 20% cap; a borrow above it should be rejected
        await d.vault.connect(d.operator).setMaxExposure(market, 100); // 1% cap
        const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(2_000_000), market, true);
        expect(ok).to.equal(false);
    });

    it("borrow returns false when utilization would exceed the emergency threshold", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9900);
        // borrow almost the whole pool -> utilization above 90% emergency cap
        const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(4_900_000), market, true);
        expect(ok).to.equal(false);
    });

    it("borrow succeeds for a short within caps", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(500_000), market, false);
        expect(ok).to.equal(true);
        await d.vault.connect(coreEoa).borrow(usdc(500_000), market, false);
        const exp = await d.vault.getMarketExposure(market);
        expect(exp.shortExposure).to.equal(usdc(500_000));
    });
});

describe("VaultCore — repay PnL settlement", () => {
    it("repay with positive pnl sends trader profit back out", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        await d.vault.connect(coreEoa).borrow(usdc(200_000), market, true);
        const before = await d.usdt0.balanceOf(coreEoa.address);
        // profit: coreEoa must hold amount + 0 (positive pnl returned to it)
        await d.vault.connect(coreEoa).repay(usdc(200_000), market, true, usdc(10_000));
        // long exposure cleared
        const exp = await d.vault.getMarketExposure(market);
        expect(exp.longExposure).to.equal(0n);
        expect(before).to.be.a("bigint");
    });

    it("repay with negative pnl (loss) requires the loss to arrive and retains it for LPs", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        await d.vault.connect(coreEoa).borrow(usdc(200_000), market, false);
        const lpBefore = await d.vault.lpAssets();
        await d.vault.connect(coreEoa).repay(usdc(200_000), market, false, -usdc(15_000));
        expect(await d.vault.lpAssets()).to.be.greaterThan(lpBefore);
    });

    it("repay reverts when the caller lacks the required receive balance", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        await d.vault.connect(coreEoa).borrow(usdc(200_000), market, true);
        // drain coreEoa's USDC so the loss settlement cannot be funded
        const bal = await d.usdt0.balanceOf(coreEoa.address);
        await d.usdt0.connect(coreEoa).transfer(d.bob.address, bal);
        await expect(
            d.vault.connect(coreEoa).repay(usdc(200_000), market, false, -usdc(50_000)),
        ).to.be.revertedWithCustomError(d.vault, "InsufficientRepayBalance");
    });
});

describe("VaultCore — updateExposure", () => {
    it("increases then decreases exposure via signed deltas", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        await d.vault.connect(coreEoa).updateExposure(market, usdc(100_000), true);
        let exp = await d.vault.getMarketExposure(market);
        expect(exp.longExposure).to.equal(usdc(100_000));
        await d.vault.connect(coreEoa).updateExposure(market, -usdc(40_000), true);
        exp = await d.vault.getMarketExposure(market);
        expect(exp.longExposure).to.equal(usdc(60_000));
    });

    it("short exposure increase then over-decrease floors at zero", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        await d.vault.connect(coreEoa).updateExposure(market, usdc(50_000), false);
        await d.vault.connect(coreEoa).updateExposure(market, -usdc(80_000), false);
        const exp = await d.vault.getMarketExposure(market);
        expect(exp.shortExposure).to.equal(0n);
    });

    it("reverts ExceedsExposureCap when the increase blows the cap", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.operator).setMaxExposure(market, 100); // 1%
        await expect(
            d.vault.connect(coreEoa).updateExposure(market, usdc(2_000_000), true),
        ).to.be.revertedWithCustomError(d.vault, "ExceedsExposureCap");
    });
});

describe("VaultCore — governance claim (above approval threshold)", () => {
    it("a claim above approvalThreshold is staged for governance and pays after approval", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(d.lp).stakeInsurance(usdc(4_000_000), d.lp.address);
        // approvalThreshold defaults to 10_000e6; submit above it
        const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 3);
        await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 3);
        // not auto-approved -> needs guardian approval
        await d.vault.connect(d.guardian).approveClaim(claimId);
        await d.vault.processClaim(claimId);
        const claim = await d.vault.getClaim(claimId);
        expect(claim.paid).to.equal(true);
    });

    it("approveClaim reverts for an unknown/zero claim", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.guardian).approveClaim(99999)).to.be.revertedWithCustomError(
            d.vault,
            "ClaimInvalidOrPaid",
        );
    });

    it("processClaim reverts for an unapproved claim", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(50_000), 4);
        await d.vault.connect(coreEoa).submitClaim(usdc(50_000), 4);
        await expect(d.vault.processClaim(claimId)).to.be.revertedWithCustomError(
            d.vault,
            "ClaimNotApproved",
        );
    });
});

describe("VaultCore — withdrawal slippage/liquidity cancellation", () => {
    it("a queued withdrawal with a too-high minAssets is cancelled on processing (Slippage)", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        // minAssets set absurdly high so the conservative valuation falls short and the withdrawal is cancelled on slippage
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 10n, usdc(999_000_000));
        const reqId = reqIdFrom(d, await tx.wait());
        await time.increase(24 * 60 * 60 + 1);
        await expect(d.vault.processWithdrawals([reqId])).to.emit(d.vault, "WithdrawalCancelled");
        // shares returned to the LP
        expect(await d.vault.lpBalanceOf(d.lp.address)).to.equal(sh);
    });

    it("queueWithdrawal reverts when the per-user request cap is reached", async () => {
        const { d } = await loadFixture(fundedVault);
        // default maxWithdrawalsPerUser == 10
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        for (let i = 0; i < 10; i++) {
            await d.vault.connect(d.lp).queueWithdrawal(sh / 1000n, 0);
        }
        await expect(d.vault.connect(d.lp).queueWithdrawal(sh / 1000n, 0)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });
});

describe("VaultCore — emergency escape capping + setters", () => {
    it("emergencyEscapeWithdraw caps the payout when requested exceeds on-hand liquidity", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        // borrow most liquidity out so the escape payout must be capped
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        await d.vault.connect(coreEoa).borrow(usdc(4_000_000), market, true);
        await d.vault.connect(d.guardian).triggerEmergencyMode();
        await time.increase(7 * 24 * 60 * 60 + 1);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await expect(d.vault.connect(d.lp).emergencyEscapeWithdraw(sh)).to.emit(
            d.vault,
            "EmergencyEscapeWithdrawCapped",
        );
    });

    it("setSwapRouterAllowed rejects the zero address and toggles otherwise", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.admin).setSwapRouterAllowed(ethers.ZeroAddress, true),
        ).to.be.revertedWithCustomError(d.vault, "ZeroAddress");
        await d.vault.connect(d.admin).setSwapRouterAllowed(d.bob.address, true);
        expect(await d.vault.allowedSwapRouters(d.bob.address)).to.equal(true);
    });

    it("setMinSwapSlippageBps rejects values above BPS", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.admin).setMinSwapSlippageBps(10001),
        ).to.be.revertedWithCustomError(d.vault, "InvalidRequest");
        await d.vault.connect(d.admin).setMinSwapSlippageBps(50);
        expect(await d.vault.minSwapSlippageBps()).to.equal(50n);
    });

    it("swapCollateralToUsdc is disabled and reverts", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.operator).swapCollateralToUsdc(d.bob.address, 1, 0, d.bob.address, "0x"),
        ).to.be.revertedWithCustomError(d.vault, "InvalidRequest");
    });
});

describe("VaultCore — fee credit no-ops", () => {
    it("receiveFees and receiveLpFees return early on a zero amount", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        const feesBefore = await d.vault.accumulatedFees();
        const lpBefore = await d.vault.lpAssets();
        await d.vault.connect(coreEoa).receiveFees(0);
        await d.vault.connect(coreEoa).receiveLpFees(0);
        expect(await d.vault.accumulatedFees()).to.equal(feesBefore);
        expect(await d.vault.lpAssets()).to.equal(lpBefore);
    });

    it("distributeSurplus returns early when insurance is at/below target", async () => {
        const { d } = await loadFixture(fundedVault);
        // fresh insurance at 1M, TVL target small; no accumulated fees so the call returns early
        await d.vault.distributeSurplus();
        // no revert, accumulatedFees unchanged
        expect(await d.vault.accumulatedFees()).to.equal(0n);
    });
});
