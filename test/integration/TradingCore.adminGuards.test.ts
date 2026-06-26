import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { openMarket, createOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, OrderType, TimeInForce } from "../helpers/constants";

const price = (n: number) => BigInt(n) * 10n ** 18n;
const ADDR1 = "0x00000000000000000000000000000000000000A1";
const ADDR2 = "0x00000000000000000000000000000000000000A2";
const ADDR3 = "0x00000000000000000000000000000000000000A3";
const FRESH_MARKET = "0x00000000000000000000000000000000000000C9";

/**
 * Verifies TradingCore's administrative wiring, rotation, and access guards:
 *   - wiring setters: ZeroAddress reverts (setContracts / setCollateralRegistry)
 *   - referral-registry rotation: mismatch + timelock-active reverts + access
 *   - RWA-contracts rotation: mismatch + timelock-active reverts + access
 *   - setMarketId: access, too-long, rebind-forbidden
 *   - access-gated entrypoints: recordFailedRepayment / liquidatePosition /
 *     resolveFailedRepayment / updatePositionOwner direct call
 *   - createOrder validation: POST_ONLY-on-market, reduce-only first guard,
 *     reduce-only increase operand, visible-size-too-large, low-uncertainty
 *     POST_ONLY oracle reject, owner==msg.sender self-delegation operand
 *   - executeOrder on a non-existent order (account==0 short-circuits)
 *   - the whenNotPaused gate for trigger setters and createOrder
 *   - cleanupPositions cap clamping (maxClean > cap)
 *   - _enforcePortfolioRiskFor early-return when disabled
 *   - no-op withdrawal ledgers (zero balance)
 */
describe("TradingCore — admin wiring, rotation, and access guards", () => {
    // ───────────────────────────────────────────────────────────────────
    // Wiring setters — ZeroAddress guards
    // ───────────────────────────────────────────────────────────────────
    describe("wiring setter zero-address guards", () => {
        it("setContracts reverts on a zero vault address", async () => {
            const d = await loadFixture(deployConfigured);
            const oa = await d.oracle.getAddress();
            const pt = await d.positionToken.getAddress();
            await expect(
                d.tradingCore.connect(d.admin).setContracts(ethers.ZeroAddress, oa, pt),
            ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
        });

        it("setCollateralRegistry reverts on a zero address", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setCollateralRegistry(ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Referral-registry rotation guards
    // ───────────────────────────────────────────────────────────────────
    describe("referral-registry rotation", () => {
        it("rejects a non-admin proposeReferralRegistry", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).proposeReferralRegistry(ADDR1)).to.be.reverted;
        });

        it("rejects a non-admin setReferralRegistry", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).setReferralRegistry(ADDR1)).to.be.reverted;
        });

        it("setReferralRegistry reverts when the value does not match the staged proposal", async () => {
            const d = await loadFixture(deployConfigured);
            // no proposal staged (pending == 0); a non-zero arg cannot match
            await expect(
                d.tradingCore.connect(d.admin).setReferralRegistry(ADDR1),
            ).to.be.revertedWithCustomError(d.tradingCore, "PendingReferralRegistryMismatch");
        });

        it("setReferralRegistry reverts while the timelock is still active", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).proposeReferralRegistry(ADDR1);
            await expect(
                d.tradingCore.connect(d.admin).setReferralRegistry(ADDR1),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReferralRegistryTimelockActive");
        });

        it("applies a referral-registry rotation after the timelock elapses", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).proposeReferralRegistry(ADDR1);
            await time.increase(48 * 60 * 60 + 1);
            await expect(d.tradingCore.connect(d.admin).setReferralRegistry(ADDR1)).to.emit(
                d.tradingCore,
                "ReferralRegistryUpdated",
            );
            expect(await d.tradingCore.referralRegistry()).to.equal(ethers.getAddress(ADDR1));
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // RWA-contracts rotation guards (already initialized in fixture)
    // ───────────────────────────────────────────────────────────────────
    describe("RWA-contracts rotation", () => {
        it("rejects a non-admin proposeRWAContracts", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).proposeRWAContracts(ADDR1, ADDR2, ADDR3),
            ).to.be.reverted;
        });

        it("rejects a non-admin setRWAContracts", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).setRWAContracts(ADDR1, ADDR2, ADDR3)).to.be
                .reverted;
        });

        it("setRWAContracts reverts on a mismatch against the staged proposal", async () => {
            const d = await loadFixture(deployConfigured);
            // nothing staged -> non-zero args cannot match the (zero) pending triple
            await expect(
                d.tradingCore.connect(d.admin).setRWAContracts(ADDR1, ADDR2, ADDR3),
            ).to.be.revertedWithCustomError(d.tradingCore, "PendingRWAMismatch");
        });

        it("setRWAContracts reverts while the rotation timelock is active", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).proposeRWAContracts(ADDR1, ADDR2, ADDR3);
            await expect(
                d.tradingCore.connect(d.admin).setRWAContracts(ADDR1, ADDR2, ADDR3),
            ).to.be.revertedWithCustomError(d.tradingCore, "RWATimelockActive");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // setMarketId guards
    // ───────────────────────────────────────────────────────────────────
    describe("setMarketId guards", () => {
        it("rejects a non-operator caller", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).setMarketId(FRESH_MARKET, "X")).to.be.reverted;
        });

        it("reverts when the market id exceeds 32 bytes", async () => {
            const d = await loadFixture(deployConfigured);
            const tooLong = "X".repeat(33);
            await expect(
                d.tradingCore.connect(d.admin).setMarketId(FRESH_MARKET, tooLong),
            ).to.be.revertedWithCustomError(d.tradingCore, "MarketIdTooLong");
        });

        it("refuses to rebind the id of a market with open interest", async () => {
            const d = await loadFixture(deployConfigured);
            // open a position so the market carries open interest
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await expect(
                d.tradingCore.connect(d.admin).setMarketId(d.market, "ETH-USD"),
            ).to.be.revertedWithCustomError(d.tradingCore, "MarketIdRebindForbidden");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Access-gated entrypoints
    // ───────────────────────────────────────────────────────────────────
    describe("role-gated entrypoints reject unauthorized callers", () => {
        it("recordFailedRepayment is TRADING_CORE_ROLE only", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).recordFailedRepayment(1, usdc(100), d.market, true, 0),
            ).to.be.reverted;
        });

        it("liquidatePosition is LIQUIDATOR_ROLE only", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).liquidatePosition(1)).to.be.reverted;
        });

        it("resolveFailedRepayment is admin only", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).resolveFailedRepayment(1)).to.be.reverted;
        });

        it("updatePositionOwner reverts when not called by the position token", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).updatePositionOwner(1, d.bob.address, d.alice.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotPositionToken");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // createOrder validation
    // ───────────────────────────────────────────────────────────────────
    describe("createOrder validation", () => {
        it("POST_ONLY on a MARKET_INCREASE reverts PostOnlyNotAllowedForMarket", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        tif: TimeInForce.POST_ONLY,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "PostOnlyNotAllowedForMarket");
        });

        it("POST_ONLY on a MARKET_DECREASE reverts PostOnlyNotAllowedForMarket", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_DECREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: 0n,
                        tif: TimeInForce.POST_ONLY,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "PostOnlyNotAllowedForMarket");
        });

        it("reduce-only order with no positionId reverts at the first guard", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.LIMIT_DECREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: 0n,
                        triggerPrice: price(55_000),
                        isReduceOnly: true,
                        positionId: 0,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReduceOnlyRequiresPosition");
        });

        it("reduce-only MARKET_INCREASE (with positionId) reverts at the increase guard", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        isReduceOnly: true,
                        positionId: 1,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReduceOnlyRequiresPosition");
        });

        it("visible size larger than the order size reverts InvalidVisibleSize", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        visibleSize: usdc(20_000), // > sizeDelta
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidVisibleSize");
        });

        it("POST_ONLY rejects when oracle uncertainty exceeds the tightened bound", async () => {
            const d = await loadFixture(deployConfigured);
            // shrink maxOracleUncertainty to ~0 so confidence/spot > mou/2 -> InvalidOraclePrice
            await d.tradingCore.connect(d.admin).setParams(0, 1, 0, 0, 0, 0, 0);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.LIMIT_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        triggerPrice: price(45_000),
                        isLong: true,
                        tif: TimeInForce.POST_ONLY,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidOraclePrice");
        });

        it("accepts an order whose owner equals the caller (explicit self-delegation)", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.LIMIT_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        triggerPrice: price(45_000),
                        isLong: true,
                        owner: d.alice.address, // owner == msg.sender (self-delegation)
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.emit(d.tradingCore, "OrderCreated");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // executeOrder on a non-existent order (account == 0 short-circuit)
    // ───────────────────────────────────────────────────────────────────
    describe("executeOrder account==0 short-circuit", () => {
        it("reverts cleanly when the order id does not exist", async () => {
            const d = await loadFixture(deployConfigured);
            // the breaker modifier and the body both short-circuit on account==0,
            // then the executor reverts because there is nothing to fill.
            await expect(d.tradingCore.connect(d.keeper).executeOrder(999_999, [])).to.be.reverted;
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // whenNotPaused gate for trigger setters and createOrder
    // ───────────────────────────────────────────────────────────────────
    describe("paused-gate enforcement", () => {
        it("setStopLoss / setTakeProfit / setTrailingStop revert while paused", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await d.tradingCore.connect(d.guardian).pause();
            await expect(d.tradingCore.connect(d.alice).setStopLoss(id, price(40_000))).to.be.reverted;
            await expect(d.tradingCore.connect(d.alice).setTakeProfit(id, price(60_000))).to.be.reverted;
            await expect(d.tradingCore.connect(d.alice).setTrailingStop(id, 500)).to.be.reverted;
            await d.tradingCore.connect(d.admin).unpause();
        });

        it("createOrder reverts while paused", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.guardian).pause();
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.reverted;
            await d.tradingCore.connect(d.admin).unpause();
        });

        it("addCollateral reverts while paused", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await d.tradingCore.connect(d.guardian).pause();
            await expect(
                d.tradingCore.connect(d.alice).addCollateral(id, usdc(500), 0, false),
            ).to.be.reverted;
            await d.tradingCore.connect(d.admin).unpause();
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // cleanupPositions cap clamp (maxClean > cap)
    // ───────────────────────────────────────────────────────────────────
    describe("cleanupPositions cap clamp", () => {
        it("clamps a self-serve maxClean above the cap and returns a count", async () => {
            const d = await loadFixture(deployConfigured);
            // maxClean (100) > self cap (20) -> the request is clamped to the cap
            const cleaned = await d.tradingCore
                .connect(d.alice)
                .cleanupPositions.staticCall(d.alice.address, 100);
            expect(cleaned).to.equal(0n);
            await d.tradingCore.connect(d.alice).cleanupPositions(d.alice.address, 100);
        });

        it("rejects cleaning another account without admin", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).cleanupPositions(d.bob.address, 5),
            ).to.be.revertedWithCustomError(d.tradingCore, "Unauthorized");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // _enforcePortfolioRiskFor early-return when disabled
    // ───────────────────────────────────────────────────────────────────
    describe("portfolio-risk disabled early return", () => {
        it("withdrawCollateral succeeds with portfolio risk disabled", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setPortfolioRiskConfig(false, true, 500, 4000, 20);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(3_000),
            });
            await time.increase(120);
            await d.tradingCore.connect(d.alice).withdrawCollateral(id, usdc(200));
            const pos = await d.tradingCore.getPosition(id);
            expect(pos.size).to.be.greaterThan(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // No-op withdrawal ledgers (zero balance early returns)
    // ───────────────────────────────────────────────────────────────────
    describe("withdrawal ledger no-ops", () => {
        it("withdrawOrderRefund / withdrawKeeperFees / withdrawOrderCollateralRefund are no-ops with no balance", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.alice).withdrawOrderRefund();
            await d.tradingCore.connect(d.alice).withdrawKeeperFees();
            await d.tradingCore.connect(d.alice).withdrawOrderCollateralRefund();
            const [keeperFee, orderRefund, orderCollateralRefund] = await d.tradingCore.getBalances(
                d.alice.address,
            );
            expect(keeperFee).to.equal(0n);
            expect(orderRefund).to.equal(0n);
            expect(orderCollateralRefund).to.equal(0n);
        });
    });
});
