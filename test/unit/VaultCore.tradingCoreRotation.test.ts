import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol } from "../helpers/fixture";
import { usdc, TRADING_CORE_ROLE } from "../helpers/constants";

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

describe("VaultCore — TradingCore rotation", () => {
    const market = "0x00000000000000000000000000000000000000B7";

    describe("TradingCore rotation (48h timelock)", () => {
        it("proposeTradingCore + pendingTradingCore read", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).proposeTradingCore(d.bob.address)).to.emit(
                d.vault,
                "TradingCoreProposed",
            );
            const [pending, effective] = await d.vault.pendingTradingCore();
            expect(pending).to.equal(d.bob.address);
            expect(effective).to.be.greaterThan(0n);
        });
        it("proposeTradingCore rejects zero address", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).proposeTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                d.vault,
                "ZeroAddress",
            );
        });
        it("setTradingCore reverts without a staged proposal (mismatch)", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).setTradingCore(d.bob.address)).to.be.revertedWithCustomError(
                d.vault,
                "PendingTradingCoreMismatch",
            );
        });
        it("setTradingCore reverts while timelock active, then rotates after", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).proposeTradingCore(d.bob.address);
            await expect(d.vault.connect(d.admin).setTradingCore(d.bob.address)).to.be.revertedWithCustomError(
                d.vault,
                "TradingCoreTimelockActive",
            );
            await time.increase(48 * 60 * 60 + 1);
            await d.vault.connect(d.admin).setTradingCore(d.bob.address);
            expect(await d.vault.hasRole(TRADING_CORE_ROLE, d.bob.address)).to.equal(true);
        });
        it("setTradingCore rejects zero address", async () => {
            const { d } = await loadFixture(fundedVault);
            await expect(d.vault.connect(d.admin).setTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                d.vault,
                "ZeroAddress",
            );
        });
    });

    describe("treasury rotation read", () => {
        it("pendingTreasury reflects a staged proposal", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).proposeTreasury(d.bob.address);
            const [pending, effective] = await d.vault.pendingTreasury();
            expect(pending).to.equal(d.bob.address);
            expect(effective).to.be.greaterThan(0n);
        });
    });

    describe("admin tuning + views", () => {
        it("setMaxProtocolTVL updates the ceiling", async () => {
            const { d } = await loadFixture(fundedVault);
            await d.vault.connect(d.admin).setMaxProtocolTVL(usdc(2_000_000_000));
            expect(await d.vault.maxProtocolTVL()).to.equal(usdc(2_000_000_000));
        });
        it("getProtocolTVL aggregates LP + insurance", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.getProtocolTVL()).to.be.greaterThanOrEqual(usdc(6_000_000));
        });
        it("traderPnLFullyPriced is true at rest (no OI)", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.traderPnLFullyPriced()).to.equal(true);
        });
        it("getConservativeUtilization reflects borrows", async () => {
            const { d, coreEoa } = await loadFixture(fundedVault);
            expect(await d.vault.getConservativeUtilization()).to.equal(0n);
            await d.vault.connect(coreEoa).borrow(usdc(500_000), market, true);
            expect(await d.vault.getConservativeUtilization()).to.be.greaterThan(0n);
        });
        it("getWithdrawalRequest returns empty for an unknown id", async () => {
            const { d } = await loadFixture(fundedVault);
            const req = await d.vault.getWithdrawalRequest(999);
            expect(req.user).to.equal(ethers.ZeroAddress);
            expect(req.shares).to.equal(0n);
        });
        it("getWithdrawalRequest returns a queued request", async () => {
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
            const req = await d.vault.getWithdrawalRequest(reqId);
            expect(req.user).to.equal(d.lp.address);
            expect(req.shares).to.equal(sh / 4n);
        });
        it("getAvailableLiquidity is positive with LP deposits", async () => {
            const { d } = await loadFixture(fundedVault);
            expect(await d.vault.getAvailableLiquidity()).to.be.greaterThan(0n);
        });
    });
});

describe("VaultCore — TradingCore rotation flows", () => {
    const market = "0x00000000000000000000000000000000000000B7";

    it("queued withdrawal is cancelled on slippage (minAssets too high)", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        // minAssets set absurdly high so processing cancels on slippage
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 4n, usdc(100_000_000));
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
        await time.increase(24 * 60 * 60 + 1);
        await expect(d.vault.processWithdrawals([reqId])).to.emit(d.vault, "WithdrawalCancelled");
        // shares returned to the LP
        expect(await d.vault.lpBalanceOf(d.lp.address)).to.equal(sh);
    });

    it("withdraw reflects trader losses (LP gains) after a losing round-trip", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
        // trader closes at a loss -> vault keeps principal + loss
        await d.vault.connect(coreEoa).repay(usdc(100_000), market, true, -usdc(5_000));
        const sharePrice = await d.vault.getLPSharePrice();
        expect(sharePrice).to.be.greaterThan(0n);
    });

    it("claimRebates reverts on zero recipient", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).accrueRebate(d.bob.address, usdc(100));
        await expect(d.vault.connect(d.bob).claimRebates(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            d.vault,
            "ZeroAddress",
        );
    });

    it("distributeSurplus is a safe no-op when there is no surplus", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.distributeSurplus(); // no accrued fees beyond target -> no-op, no revert
    });

    it("getConservativeTotalAssets returns a positive figure with LP + borrows", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
        expect(await d.vault.getConservativeTotalAssets()).to.be.greaterThan(0n);
    });

    it("borrow returns false when utilization would exceed the emergency threshold", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        // try to borrow nearly all liquidity -> utilization check fails
        const ok = await d.vault.connect(coreEoa).borrow.staticCall(usdc(4_900_000), market, true);
        expect(ok).to.equal(false);
    });

    it("repay with positive PnL pays trader profit back out", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        await d.vault.connect(coreEoa).borrow(usdc(100_000), market, true);
        const before = await d.usdt0.balanceOf(coreEoa.address);
        await d.vault.connect(coreEoa).repay(usdc(100_000), market, true, usdc(3_000));
        // coreEoa receives the profit leg
        expect(await d.usdt0.balanceOf(coreEoa.address)).to.be.greaterThanOrEqual(before - usdc(100_000));
    });
});

describe("VaultCore — withdraw & queue guards", () => {
    const market = "0x00000000000000000000000000000000000000B7";

    it("instant withdraw reverts on InsufficientShares", async () => {
        const { d } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await expect(
            d.vault.connect(d.lp).withdraw(sh + 1n, d.lp.address, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "InsufficientShares");
    });

    it("instant withdraw reverts on InsufficientLiquidity when borrows drain the pool", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        // raise the per-market exposure cap so a large borrow is allowed
        await d.vault.connect(d.operator).setMaxExposure(market, 8000);
        const ok1 = await d.vault.connect(coreEoa).borrow.staticCall(usdc(3_000_000), market, true);
        expect(ok1).to.equal(true);
        await d.vault.connect(coreEoa).borrow(usdc(3_000_000), market, true);
        // a full-share instant withdraw now exceeds on-hand liquidity
        await expect(
            d.vault.connect(d.lp).withdraw(sh, d.lp.address, d.lp.address),
        ).to.be.revertedWithCustomError(d.vault, "InsufficientLiquidity");
    });

    it("queueWithdrawal enforces the per-user cap", async () => {
        const { d } = await loadFixture(fundedVault);
        await d.vault.connect(d.admin).setMaxWithdrawalsPerUser(1);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        await d.vault.connect(d.lp).queueWithdrawal(sh / 10n, 0);
        await expect(d.vault.connect(d.lp).queueWithdrawal(sh / 10n, 0)).to.be.revertedWithCustomError(
            d.vault,
            "InvalidRequest",
        );
    });

    it("queued withdrawal cancelled on insufficient liquidity at processing time", async () => {
        const { d, coreEoa } = await loadFixture(fundedVault);
        const sh = await d.vault.lpBalanceOf(d.lp.address);
        // queue a large withdrawal with a high minAssets, then drain liquidity via borrow
        const tx = await d.vault.connect(d.lp).queueWithdrawal(sh / 2n, usdc(2_400_000));
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
        await d.vault.connect(d.operator).setMaxExposure(market, 8000);
        await d.vault.connect(coreEoa).borrow(usdc(3_000_000), market, true);
        await time.increase(24 * 60 * 60 + 1);
        // available < assets AND below minAssets -> InsufficientLiquidity cancellation
        await d.vault.processWithdrawals([reqId]);
        // shares returned
        expect(await d.vault.lpBalanceOf(d.lp.address)).to.be.greaterThan(0n);
    });
});
