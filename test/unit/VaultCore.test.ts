import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol, deployConfigured, type Deployment } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE, GUARDIAN_ROLE } from "../helpers/constants";

/**
 * VaultCore: LP deposits/withdrawals, insurance fund, bad-debt claims,
 * emergency mode, donations, rebates, exposure caps. Branch-focused.
 */
describe("VaultCore", () => {
    async function fundedVault() {
        const d = await deployProtocol();
        // mint USDC to LPs and traders
        for (const s of [d.lp, d.alice, d.bob]) {
            await d.usdc.mintTo(s.address, usdc(50_000_000));
            await d.usdc.connect(s).approve(await d.vault.getAddress(), ethers.MaxUint256);
        }
        return d;
    }

    describe("initialization", () => {
        it("seeds dead shares and default params", async () => {
            const d = await loadFixture(deployProtocol);
            expect(await d.vault.lpTotalShares()).to.equal(ethers.parseUnits("1", 18));
            expect(await d.vault.insTotalShares()).to.equal(ethers.parseUnits("1", 18));
            expect(await d.vault.minInitialDeposit()).to.equal(usdc(1000));
            expect(await d.vault.treasury()).to.equal(d.treasury.address);
            expect(await d.vault.asset()).to.equal(await d.usdc.getAddress());
        });
    });

    describe("deposit", () => {
        it("reverts on zero assets", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.lp).deposit(0, d.lp.address)).to.be.revertedWithCustomError(
                d.vault,
                "ZeroAssets",
            );
        });
        it("reverts on zero receiver", async () => {
            const d = await loadFixture(fundedVault);
            await expect(
                d.vault.connect(d.lp).deposit(usdc(1000), ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(d.vault, "ZeroAddress");
        });
        it("reverts when first deposit below minimum", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.lp).deposit(usdc(999), d.lp.address)).to.be.revertedWithCustomError(
                d.vault,
                "MinimumDepositRequired",
            );
        });
        it("mints shares and updates accounting on first deposit", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address)).to.emit(d.vault, "Deposit");
            expect(await d.vault.lpAssets()).to.equal(usdc(1_000_000));
            expect(await d.vault.lpBalanceOf(d.lp.address)).to.be.greaterThan(0n);
        });
        it("subsequent deposits mint proportional shares", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const s1 = await d.vault.lpBalanceOf(d.lp.address);
            await d.vault.connect(d.alice).deposit(usdc(500_000), d.alice.address);
            const s2 = await d.vault.lpBalanceOf(d.alice.address);
            expect(s2).to.be.approximately(s1 / 2n, s1 / 1000n);
        });
    });

    describe("withdraw (instant)", () => {
        it("reverts on zero shares", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            await expect(d.vault.connect(d.lp).withdraw(0, d.lp.address, d.lp.address)).to.be.revertedWithCustomError(
                d.vault,
                "ZeroShares",
            );
        });
        it("reverts when caller is not owner", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            await d.vault.connect(d.alice).deposit(usdc(1_000_000), d.alice.address);
            // owner=lp has plenty of shares; alice (msg.sender) withdraws a small
            // amount against lp -> passes InsufficientShares, hits NotOwner branch.
            await expect(
                d.vault.connect(d.alice).withdraw(ethers.parseUnits("1", 18), d.alice.address, d.lp.address),
            ).to.be.revertedWithCustomError(d.vault, "NotOwner");
        });
        it("burns shares and returns USDC", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            const balBefore = await d.usdc.balanceOf(d.lp.address);
            await d.vault.connect(d.lp).withdraw(sh / 2n, d.lp.address, d.lp.address);
            expect(await d.usdc.balanceOf(d.lp.address)).to.be.greaterThan(balBefore);
        });
        it("reverts withdraw during emergency mode", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            await expect(
                d.vault.connect(d.lp).withdraw(sh, d.lp.address, d.lp.address),
            ).to.be.revertedWithCustomError(d.vault, "EmergencyModeActive");
        });
    });

    describe("queued withdrawals", () => {
        it("queues, enforces cooldown, then processes", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 2n, 0);
            const rc = await tx.wait();
            const ev = rc!.logs
                .map((l: any) => {
                    try {
                        return d.vault.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.name === "WithdrawalQueued");
            const reqId = ev!.args[2];
            // not mature yet -> processed count 0
            expect(await d.vault.processWithdrawals.staticCall([reqId])).to.equal(0n);
            await time.increase(24 * 60 * 60 + 1);
            const balBefore = await d.usdc.balanceOf(d.lp.address);
            await d.vault.processWithdrawals([reqId]);
            expect(await d.usdc.balanceOf(d.lp.address)).to.be.greaterThan(balBefore);
        });
        it("allows cancelling a queued withdrawal", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 2n, 0);
            const rc = await tx.wait();
            const ev = rc!.logs
                .map((l: any) => {
                    try {
                        return d.vault.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.name === "WithdrawalQueued");
            const reqId = ev!.args[2];
            await expect(d.vault.connect(d.lp).cancelQueuedWithdrawal(reqId)).to.emit(d.vault, "WithdrawalCancelled");
            expect(await d.vault.lpBalanceOf(d.lp.address)).to.equal(sh);
        });
        it("reverts cancelling someone else's request", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
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
            await expect(d.vault.connect(d.alice).cancelQueuedWithdrawal(reqId)).to.be.revertedWithCustomError(
                d.vault,
                "NotOwner",
            );
        });
    });

    describe("insurance fund", () => {
        it("reverts staking below minimum initial", async () => {
            const d = await loadFixture(fundedVault);
            await expect(
                d.vault.connect(d.lp).stakeInsurance(usdc(999), d.lp.address),
            ).to.be.revertedWithCustomError(d.vault, "MinimumInsuranceDepositRequired");
        });
        it("stakes and tracks insurance assets", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.lp).stakeInsurance(usdc(100_000), d.lp.address)).to.emit(
                d.vault,
                "InsuranceStaked",
            );
            expect(await d.vault.insuranceAssets()).to.equal(usdc(100_000));
        });
        it("enforces unstake cooldown lifecycle", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).stakeInsurance(usdc(100_000), d.lp.address);
            const sh = await d.vault.insBalanceOf(d.lp.address);
            const partial = sh / 2n; // keep the pool healthy after unstake
            // cannot unstake before requesting
            await expect(
                d.vault.connect(d.lp).unstakeInsurance(partial, d.lp.address),
            ).to.be.revertedWithCustomError(d.vault, "CooldownNotStarted");
            await d.vault.connect(d.lp).requestUnstake();
            await expect(
                d.vault.connect(d.lp).unstakeInsurance(partial, d.lp.address),
            ).to.be.revertedWithCustomError(d.vault, "CooldownNotComplete");
            await time.increase(7 * 24 * 60 * 60 + 1);
            await expect(d.vault.connect(d.lp).unstakeInsurance(partial, d.lp.address)).to.emit(
                d.vault,
                "InsuranceUnstaked",
            );
        });
        it("can cancel an unstake request", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).stakeInsurance(usdc(100_000), d.lp.address);
            await d.vault.connect(d.lp).requestUnstake();
            expect(await d.vault.unstakeRequestTime(d.lp.address)).to.be.greaterThan(0n);
            await d.vault.connect(d.lp).cancelUnstakeRequest();
            expect(await d.vault.unstakeRequestTime(d.lp.address)).to.equal(0n);
        });
        it("reverts cancelling when no request exists", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.lp).cancelUnstakeRequest()).to.be.revertedWithCustomError(
                d.vault,
                "CooldownNotStarted",
            );
        });
    });

    describe("emergency mode", () => {
        it("only guardian can trigger", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.alice).triggerEmergencyMode()).to.be.revertedWithCustomError(
                d.vault,
                "NotGuardian",
            );
        });
        it("guardian triggers, admin stops when utilization safe", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            expect(await d.vault.isEmergencyMode()).to.equal(true);
            await d.vault.connect(d.admin).stopEmergencyMode();
            expect(await d.vault.isEmergencyMode()).to.equal(false);
        });
        it("emergencyEscapeWithdraw reverts before timelock", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            await expect(d.vault.connect(d.lp).emergencyEscapeWithdraw(sh)).to.be.revertedWithCustomError(
                d.vault,
                "EscapeTimelockNotExpired",
            );
        });
        it("emergencyEscapeWithdraw works after 7-day timelock", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            const sh = await d.vault.lpBalanceOf(d.lp.address);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            await time.increase(7 * 24 * 60 * 60 + 1);
            const balBefore = await d.usdc.balanceOf(d.lp.address);
            await d.vault.connect(d.lp).emergencyEscapeWithdraw(sh);
            expect(await d.usdc.balanceOf(d.lp.address)).to.be.greaterThan(balBefore);
        });
    });

    describe("treasury rotation (48h timelock)", () => {
        it("reverts setTreasury without staged proposal", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).setTreasury(d.bob.address)).to.be.revertedWithCustomError(
                d.vault,
                "PendingTreasuryMismatch",
            );
        });
        it("propose then apply after timelock", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).proposeTreasury(d.bob.address);
            await expect(d.vault.connect(d.admin).setTreasury(d.bob.address)).to.be.revertedWithCustomError(
                d.vault,
                "TreasuryTimelockActive",
            );
            await time.increase(48 * 60 * 60 + 1);
            await expect(d.vault.connect(d.admin).setTreasury(d.bob.address)).to.emit(d.vault, "TreasuryUpdated");
            expect(await d.vault.treasury()).to.equal(d.bob.address);
        });
    });

    describe("donations", () => {
        it("records untracked USDC as donation and sweeps it", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            // donate by direct transfer
            await d.usdc.connect(d.alice).transfer(await d.vault.getAddress(), usdc(10_000));
            const donated = await d.vault.recordDonation.staticCall();
            expect(donated).to.equal(usdc(10_000));
            await d.vault.recordDonation();
            expect(await d.vault.donatedAssets()).to.equal(usdc(10_000));
            await d.vault.connect(d.admin).sweepDonations(usdc(10_000), 0, 0);
            expect(await d.vault.donatedAssets()).to.equal(0n);
        });
        it("reverts sweeping more than donated", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).sweepDonations(usdc(1), 0, 0)).to.be.revertedWithCustomError(
                d.vault,
                "InvalidRequest",
            );
        });
    });

    describe("TradingCore-gated functions", () => {
        it("borrow reverts for non-TradingCore", async () => {
            const d = await loadFixture(fundedVault);
            await expect(
                d.vault.connect(d.alice).borrow(usdc(1000), d.market || d.alice.address, true),
            ).to.be.revertedWithCustomError(d.vault, "NotTradingCore");
        });
        it("repay reverts for non-TradingCore", async () => {
            const d = await loadFixture(fundedVault);
            await expect(
                d.vault.connect(d.alice).repay(usdc(1000), d.alice.address, true, 0),
            ).to.be.revertedWithCustomError(d.vault, "NotTradingCore");
        });
        it("receiveFees reverts for non-TradingCore", async () => {
            const d = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.alice).receiveFees(usdc(1))).to.be.revertedWithCustomError(
                d.vault,
                "NotTradingCore",
            );
        });
    });

    describe("disabled functions", () => {
        it("repayWithCollateral reverts (disabled)", async () => {
            const d = await loadFixture(fundedVault);
            // Grant alice TRADING_CORE_ROLE to reach the revert branch
            await d.vault.connect(d.admin).grantRole(TRADING_CORE_ROLE, d.alice.address);
            await expect(
                d.vault.connect(d.alice).repayWithCollateral(0, d.alice.address, true, 0, d.alice.address, 0),
            ).to.be.revertedWithCustomError(d.vault, "InvalidRequest");
        });
        it("updateProtocolTVL reverts (deprecated)", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).grantRole(
                ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
                d.alice.address,
            );
            await expect(d.vault.connect(d.alice).updateProtocolTVL(1)).to.be.revertedWithCustomError(
                d.vault,
                "InvalidRequest",
            );
        });
    });

    describe("view helpers", () => {
        it("getProtocolTVL aggregates LP + insurance", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            await d.vault.connect(d.lp).stakeInsurance(usdc(100_000), d.lp.address);
            const tvl = await d.vault.getProtocolTVL();
            expect(tvl).to.be.greaterThanOrEqual(usdc(1_100_000));
        });
        it("getLPSharePrice and utilization sane at rest", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            expect(await d.vault.getUtilization()).to.equal(0n);
            expect(await d.vault.getLPSharePrice()).to.be.greaterThan(0n);
        });
        it("maxRedeem returns 0 in emergency", async () => {
            const d = await loadFixture(fundedVault);
            await d.vault.connect(d.lp).deposit(usdc(1_000_000), d.lp.address);
            await d.vault.connect(d.guardian).triggerEmergencyMode();
            expect(await d.vault.maxRedeem(d.lp.address)).to.equal(0n);
        });
    });
});
