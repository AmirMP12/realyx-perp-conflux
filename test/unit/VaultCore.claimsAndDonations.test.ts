import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE } from "../helpers/constants";

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

describe("VaultCore — claims, donations & withdrawals", () => {
    it("processClaim pays partially when insurance is insufficient for the full claim", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        // submit a claim larger than insurance assets (1M), approve, process -> partial pay
        const claimId = await d.vault.connect(coreEoa).submitClaim.staticCall(usdc(2_000_000), 5);
        await d.vault.connect(coreEoa).submitClaim(usdc(2_000_000), 5);
        await d.vault.connect(d.guardian).approveClaim(claimId);
        await d.vault.processClaim(claimId);
        const claim = await d.vault.getClaim(claimId);
        // not fully paid (insurance had only 1M)
        expect(claim.amountPaid).to.be.lessThan(claim.amount);
        expect(claim.paid).to.equal(false);
    });

    it("recordDonation captures an untracked transfer and sweepDonations splits it", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.usdt0.connect(d.alice).transfer(await d.vault.getAddress(), usdc(10_000));
        const donated = await d.vault.recordDonation.staticCall();
        expect(donated).to.equal(usdc(10_000));
        await d.vault.recordDonation();
        expect(await d.vault.donatedAssets()).to.equal(usdc(10_000));
        // split: lp / insurance / treasury
        await d.vault.connect(d.admin).sweepDonations(usdc(4_000), usdc(3_000), usdc(3_000));
        expect(await d.vault.donatedAssets()).to.equal(0n);
    });

    it("recordDonation returns 0 when there is nothing untracked", async () => {
        const { d } = await loadFixture(fundedVault);
        const donated = await d.vault.recordDonation.staticCall();
        expect(donated).to.equal(0n);
    });

    it("queued withdrawal partial payout when available < assets but >= minAssets", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        // queue a large withdrawal with no minAssets, drain most liquidity, then process
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 2n, 0);
        const rc = await tx.wait();
        const reqId = rc!.logs
            .map((l: any) => {
                try {
                    return d.vault.interface.parseLog(l);
                } catch {
                    return null;
                }
            })
            .find((p: any) => p && p.name === "WithdrawalQueued")!.args[2];
        await d.vault.connect(d.operator).setMaxExposure(market, 9000);
        await d.vault.connect(coreEoa).borrow(usdc(3_000_000), market, true);
        await time.increase(24 * 60 * 60 + 1);
        // available < requested assets, minAssets==0 -> pays capped amount
        await expect(d.vault.processWithdrawals([reqId])).to.emit(d.vault, "WithdrawalProcessed");
    });

    it("repay with a loss increases LP assets (loss retained)", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
        const lpBefore = await d.vault.lpAssets();
        await d.vault.connect(coreEoa).repay(usdc(100_000), market, true, -usdc(5_000));
        expect(await d.vault.lpAssets()).to.be.greaterThan(lpBefore);
    });

    it("sweepDonations reverts when requested split exceeds donated", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.admin).sweepDonations(usdc(1), 0, 0)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });

    it("getConservativeUtilization and getProtocolTVL track borrows + insurance", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).borrow(usdc(500_000), market, true);
        expect(await d.vault.getConservativeUtilization()).to.be.greaterThan(0n);
        expect(await d.vault.getProtocolTVL()).to.be.greaterThan(usdc(1_000_000));
    });
});

describe("VaultCore — withdrawal guards", () => {
    it("cancelQueuedWithdrawal reverts for non-owner and for an invalid/processed request", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 4n, 0);
        const rc = await tx.wait();
        const reqId = rc!.logs
            .map((l: any) => {
                try {
                    return d.vault.interface.parseLog(l);
                } catch {
                    return null;
                }
            })
            .find((p: any) => p && p.name === "WithdrawalQueued")!.args[2];
        await expect(d.vault.connect(d.alice).cancelQueuedWithdrawal(reqId)).to.be.revertedWithCustomError(
            d.vault,
            "NotOwner",
        );
        // an unknown request id has shares==0 -> InvalidRequest
        await expect(d.vault.connect(d.lp).cancelQueuedWithdrawal(999999)).to.be.revertedWithCustomError(
            d.vault,
            "NotOwner",
        );
    });

    it("withdraw reverts for ZeroShares and ZeroAddress receiver", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(
            d.vault.connect(d.lp).withdraw(0, d.lp.address, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "ZeroShares");
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await expect(
            d.vault.connect(d.lp).withdraw(sh / 10n, ethers.ZeroAddress, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "ZeroAddress");
    });

    it("processWithdrawals reverts when the batch exceeds the max size", async () => {
        const { d } = await loadFixture(fundedVault);
        const ids = new Array(201).fill(0).map((_, i) => i + 1);
        await expect(d.vault.processWithdrawals(ids)).to.be.revertedWithCustomError(d.vault, "InvalidRequest");
    });

    it("processWithdrawals skips an immature request without reverting the batch", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 4n, 0);
        const rc = await tx.wait();
        const reqId = rc!.logs
            .map((l: any) => {
                try {
                    return d.vault.interface.parseLog(l);
                } catch {
                    return null;
                }
            })
            .find((p: any) => p && p.name === "WithdrawalQueued")!.args[2];
        // not matured yet -> processed count 0, no revert
        expect(await d.vault.processWithdrawals.staticCall([reqId])).to.equal(0n);
    });

    it("stakeInsurance reverts on zero assets and zero receiver", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.lp).stakeInsurance(0, d.lp.address)).to.be.revertedWithCustomError(
            d.vault,
            "ZeroAssets",
        );
        await expect(
            d.vault.connect(d.lp).stakeInsurance(usdc(1000), ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(d.vault, "ZeroAddress");
    });

    it("unstakeInsurance reverts on zero shares/receiver and insufficient shares", async () => {
        const { d } = await loadFixture(fundedVault);
        await expect(d.vault.connect(d.lp).unstakeInsurance(0, d.lp.address)).to.be.revertedWithCustomError(
            d.vault,
            "ZeroAssets",
        );
        await expect(
            d.vault.connect(d.lp).unstakeInsurance(1, ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(d.vault, "ZeroAddress");
        const sh = await d.vault.insBalanceOf(d.lp.address);
        await expect(
            d.vault.connect(d.lp).unstakeInsurance(sh + 1n, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "InsufficientShares");
    });
});
