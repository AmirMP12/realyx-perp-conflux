import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE } from "../helpers/constants";

const market = "0x00000000000000000000000000000000000000B7";

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

describe("VaultCore — share pricing", () => {
    describe("deposit guards & first-deposit pricing", () => {
        it("first deposit below minimum reverts", async () => {
            const { d } = await loadFixture(freshVault);
            await expect(d.vault.connect(d.lp).deposit(usdc(999), d.lp.address)).to.be.revertedWithCustomError(
                d.vault,
                "MinimumDepositRequired",
            );
        });
        it("first deposit mints share-decimals-scaled shares", async () => {
            const { d } = await loadFixture(freshVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000), d.lp.address);
            expect(await d.vault.lpBalanceOf(d.lp.address)).to.be.greaterThan(0n);
        });
        it("second depositor priced against existing pool", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.alice).deposit(usdc(1_000_000), d.alice.address);
            expect(await d.vault.lpBalanceOf(d.alice.address)).to.be.greaterThan(0n);
        });
    });

    describe("conversion & preview views", () => {
        it("previewDeposit / convertToShares agree, convertToAssets / previewWithdraw agree", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.previewDeposit(usdc(1000))).to.equal(await d.vault.convertToShares(usdc(1000)));
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            expect(await d.vault.previewWithdraw(sh)).to.equal(await d.vault.convertToAssets(sh));
        });
        it("getLPSharePrice is zero before any real deposit (only dead shares, no assets)", async () => {
            const { d } = await loadFixture(freshVault);
            // only dead shares exist and totalAssets()==0 -> price 0
            expect(await d.vault.getLPSharePrice()).to.equal(0n);
        });
        it("getUtilization is zero with no borrows", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.getUtilization()).to.equal(0n);
        });
        it("maxRedeem returns shares when healthy and 0 in emergency", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.maxRedeem(d.lp.address)).to.be.greaterThan(0n);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            expect(await d.vault.maxRedeem(d.lp.address)).to.equal(0n);
        });
        it("maxDeposit is unbounded; insurance health views report healthy", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.maxDeposit(d.lp.address)).to.equal(ethers.MaxUint256);
            expect(await d.vault.isInsuranceHealthy()).to.equal(true);
            expect(await d.vault.getInsuranceHealthRatio()).to.be.greaterThan(0n);
        });
    });

    describe("borrow guards", () => {
        it("borrow returns false when amount exceeds unreserved liquidity", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(100_000_000), market, true);
            expect(ok).to.equal(false);
        });
        it("borrow returns false when the per-market exposure cap is hit", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            // default 20% cap -> 1.5M long borrow exceeds 1M cap
            const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(1_500_000), market, true);
            expect(ok).to.equal(false);
        });
        it("borrow succeeds within caps and emits a utilization alert when high", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(d.operator).setMaxExposure(market, 9000);
            // borrow enough to cross the restriction threshold (75%) -> UtilizationAlert
            await expect(d.vault.connect(coreEoa).borrow(usdc(4_000_000), market, true)).to.emit(
                d.vault,
                "UtilizationAlert",
            );
        });
        it("borrow reverts in emergency mode", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            await expect(d.vault.connect(coreEoa).borrow(usdc(100_000), market, true)).to.be.revertedWithCustomError(
                d.vault,
                "EmergencyModeActive",
            );
        });
    });

    describe("repay InsufficientRepayBalance guard", () => {
        it("reverts when caller lacks USDC for the loss leg", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
            // drain coreEoa USDC so it cannot fund the loss leg
            const bal = await d.usdt0.balanceOf(coreEoa.address);
            await d.usdt0.connect(coreEoa).transfer(d.bob.address, bal);
            await expect(
                d.vault.connect(coreEoa).repay(usdc(100_000), market, true, -usdc(5_000)),
            ).to.be.revertedWithCustomError(d.vault, "InsufficientRepayBalance");
        });
    });

    describe("stopEmergencyMode utilization guard", () => {
        it("does not clear emergency mode while utilization is above the restriction threshold", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            await d.vault.connect(d.operator).setMaxExposure(market, 9000);
            await d.vault.connect(coreEoa).borrow(usdc(4_000_000), market, true);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            // utilization high -> stopEmergencyMode is a no-op
            await d.vault.connect(d.admin).stopEmergencyMode();
            expect(await d.vault.isEmergencyMode()).to.equal(true);
        });
    });

    describe("unstakeInsurance happy path with partial amount", () => {
        it("unstakes a healthy partial amount after cooldown", async () => {
            const { d } = await loadFixture(fundedVault);
            // stake more so a partial unstake stays above minRatio
            await d.vault.connect(d.lp).stakeInsurance(usdc(2_000_000), d.lp.address);
            const sh = await d.vault.insBalanceOf(d.lp.address);
            await d.vault.connect(d.lp).requestUnstake();
            await time.increase(7 * 24 * 60 * 60 + 1);
            await expect(d.vault.connect(d.lp).unstakeInsurance(sh / 10n, d.lp.address)).to.emit(
                d.vault,
                "InsuranceUnstaked",
            );
        });
    });
});
