import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, deployProtocol } from "../helpers/fixture";
import { createOrder, executeOrder, orderParams, openMarket, EXEC_FEE } from "../helpers/trading";
import { usdc, OrderType } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * Security-oriented tests: access control, flash-loan / rate-limit guards,
 * compliance gating, oracle-source gating, and reentrancy expectations.
 */
describe("Security — TradingCore", () => {
    describe("compliance gating", () => {
        it("blocks an un-whitelisted trader from creating orders", async () => {
            const d = await loadFixture(deployConfigured);
            // d.signers[11+] are not whitelisted; pick a fresh one
            const outsider = d.signers[12];
            await d.usdc.mintTo(outsider.address, usdc(100_000));
            await d.usdc.connect(outsider).approve(await d.tradingCore.getAddress(), ethers.MaxUint256);
            await expect(
                d.tradingCore.connect(outsider).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        isLong: true,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "ComplianceCheckFailed");
        });

        it("allows trading after whitelisting", async () => {
            const d = await loadFixture(deployConfigured);
            const outsider = d.signers[13];
            await d.compliance.setWhitelist(outsider.address, true);
            await d.usdc.mintTo(outsider.address, usdc(100_000));
            await d.usdc.connect(outsider).approve(await d.tradingCore.getAddress(), ethers.MaxUint256);
            const id = await openMarket(d, outsider, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            expect(await d.positionToken.ownerOf(id)).to.equal(outsider.address);
        });

        it("country-blocking a whitelisted user halts trading", async () => {
            const d = await loadFixture(deployConfigured);
            await d.compliance.setUserCountryBlocked(d.alice.address, true);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        isLong: true,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "ComplianceCheckFailed");
        });
    });

    describe("flash-loan / same-block guard", () => {
        it("blocks two non-operator interactions in the same block", async () => {
            const d = await loadFixture(deployConfigured);
            // tighten minInteractionDelay back to default-like via setParams(…, mid=2)
            await d.tradingCore.connect(d.admin).setParams(0, 0, 0, 0, 0, 2, 0);
            // Disable automine to land two txs in one block
            await ethers.provider.send("evm_setAutomine", [false]);
            const p = orderParams(d, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            const tx1 = await d.tradingCore.connect(d.alice).createOrder(p, { value: EXEC_FEE });
            const tx2 = await d.tradingCore.connect(d.alice).createOrder(p, { value: EXEC_FEE });
            await ethers.provider.send("evm_mine", []);
            await ethers.provider.send("evm_setAutomine", [true]);
            const r1 = await ethers.provider.getTransactionReceipt(tx1.hash);
            const r2 = await ethers.provider.getTransactionReceipt(tx2.hash);
            // exactly one of the two same-block interactions should fail
            const successes = [r1?.status, r2?.status].filter((s) => s === 1).length;
            expect(successes).to.equal(1);
        });
    });

    describe("oracle gating", () => {
        it("validateOracleForMarket reverts when no source", async () => {
            const d = await loadFixture(deployConfigured);
            const unconfigured = "0x00000000000000000000000000000000DEAD0001";
            await expect(d.tradingCore.validateOracleForMarket(unconfigured)).to.be.revertedWithCustomError(
                d.tradingCore,
                "InsufficientOracleSources",
            );
        });
        it("passes for a configured market", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.validateOracleForMarket(d.market)).to.not.be.reverted;
        });
    });

    describe("privileged function access control", () => {
        it("recordFailedRepayment is restricted to TRADING_CORE_ROLE", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).recordFailedRepayment(1, usdc(100), d.market, true, 0),
            ).to.be.reverted;
        });
        it("resolveFailedRepayment is admin-only", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).resolveFailedRepayment(1)).to.be.revertedWithCustomError(
                d.tradingCore,
                "NotAdmin",
            );
        });
        it("updatePositionOwner only callable by the position token", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).updatePositionOwner(1, d.bob.address, d.alice.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotPositionToken");
        });
        it("sweepDust is admin-only", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).sweepDust()).to.be.revertedWithCustomError(
                d.tradingCore,
                "NotAdmin",
            );
        });
    });

    describe("position ownership", () => {
        it("a non-owner cannot set stop loss", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await expect(d.tradingCore.connect(d.bob).setStopLoss(id, price(45_000))).to.be.reverted;
        });
        it("a non-owner cannot close another's position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await time.increase(120);
            const deadline = (await time.latest()) + 3600;
            await expect(
                d.tradingCore.connect(d.bob).closePosition({ positionId: id, closeSize: 0, minReceive: 0, deadline }),
            ).to.be.reverted;
        });
    });

    describe("upgrade authorization", () => {
        it("non-admin cannot propose an implementation", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).proposeImplementation(d.bob.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotAdmin");
        });
    });
});
