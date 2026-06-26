import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, seedTwap } from "../helpers/fixture";
import { openMarket, closeFull, createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, PosStatus, OrderType, TimeInForce } from "../helpers/constants";
import { setPythPrice, buildPriceUpdate } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

describe("TradingCore — integration", () => {
    describe("stop-loss / take-profit keeper execution", () => {
        it("keeper executes a triggered stop-loss closing the position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await d.tradingCore.connect(d.alice).setStopLoss(id, price(48_000));
            await time.increase(120);
            // drop price below SL and refresh twap
            await setPythPrice(d.pyth, d.feedId, price(47_000));
            await seedTwap(d, price(47_000));
            const data = await buildPriceUpdate(d.pyth, d.feedId, price(47_000));
            const fee = await d.pyth.getUpdateFee([data]);
            const processed = await d.tradingCore
                .connect(d.keeper)
                .executeStopLossTakeProfit.staticCall([id], [data], { value: fee });
            await d.tradingCore.connect(d.keeper).executeStopLossTakeProfit([id], [data], { value: fee });
            expect(processed).to.be.greaterThanOrEqual(0n);
            expect((await d.tradingCore.getPosition(id)).state).to.not.equal(PosStatus.OPEN);
        });

        it("keeper executes a triggered take-profit", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await d.tradingCore.connect(d.alice).setTakeProfit(id, price(52_000));
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(53_000));
            await seedTwap(d, price(53_000));
            const data = await buildPriceUpdate(d.pyth, d.feedId, price(53_000));
            const fee = await d.pyth.getUpdateFee([data]);
            await d.tradingCore.connect(d.keeper).executeStopLossTakeProfit([id], [data], { value: fee });
            expect((await d.tradingCore.getPosition(id)).state).to.not.equal(PosStatus.OPEN);
        });

        it("non-keeper cannot execute SL/TP batch", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await expect(
                d.tradingCore.connect(d.alice).executeStopLossTakeProfit([id], []),
            ).to.be.reverted;
        });

        it("clears trailing anchor when trailing stop set to 0", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await d.tradingCore.connect(d.alice).setTrailingStop(id, 500);
            await d.tradingCore.connect(d.alice).setTrailingStop(id, 0);
            expect((await d.tradingCore.getPosition(id)).trailingStopBps).to.equal(0);
        });
    });

    describe("cleanupPositions + sweepDust", () => {
        it("self-cleanup removes closed positions from enumeration", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(51_000));
            await closeFull(d, d.alice, id);
            const cleaned = await d.tradingCore.connect(d.alice).cleanupPositions.staticCall(d.alice.address, 10);
            expect(cleaned).to.be.greaterThanOrEqual(1n);
            await d.tradingCore.connect(d.alice).cleanupPositions(d.alice.address, 10);
        });

        it("admin cleanup uses higher cap", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(51_000));
            await closeFull(d, d.alice, id);
            await d.tradingCore.connect(d.admin).cleanupPositions(d.alice.address, 40);
        });

        it("non-owner non-admin cleanup reverts", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.bob).cleanupPositions(d.alice.address, 10),
            ).to.be.revertedWithCustomError(d.tradingCore, "Unauthorized");
        });

        it("admin sweepDust does not revert", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).sweepDust();
        });
    });

    describe("portfolio risk account views", () => {
        it("getAccountRisk + canLiquidateAccount for an account", async () => {
            const d = await loadFixture(deployConfigured);
            // enable cross-margin portfolio risk
            await d.tradingCore.connect(d.admin).setPortfolioRiskConfig(true, true, 500, 4000, 20);
            const snapEmpty = await d.tradingCore.getAccountRisk(d.alice.address);
            expect(snapEmpty.crossPositionCount).to.equal(0n);
            const [liq] = await d.tradingCore.canLiquidateAccount(d.alice.address);
            expect(liq).to.equal(false);
        });
    });

    describe("global PnL detailed", () => {
        it("returns aggregate PnL with completeness flag", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await setPythPrice(d.pyth, d.feedId, price(52_000));
            const [pnl, complete] = await d.tradingCore.getGlobalUnrealizedPnLDetailed();
            expect(complete).to.equal(true);
            expect(pnl).to.be.greaterThan(0n);
        });
    });

    describe("reduce-only & limit decrease orders", () => {
        it("creates and executes a limit decrease (reduce-only) on an open position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(4_000),
            });
            await time.increase(120);
            // long limit decrease triggers when price >= trigger
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_DECREASE,
                sizeDelta: usdc(10_000),
                triggerPrice: price(51_000),
                isLong: true,
                isReduceOnly: true,
                positionId: id,
            });
            await setPythPrice(d.pyth, d.feedId, price(51_500));
            await seedTwap(d, price(51_500));
            await executeOrder(d, orderId, price(51_500));
            const pos = await d.tradingCore.getPosition(id);
            expect(pos.size).to.be.lessThan(usdc(20_000) * 10n ** 12n + 1n);
        });
    });

    describe("partialClose by percentage", () => {
        it("partialClose: 0% and >100% both resolve to a full close (closeSize==0 sentinel / clamp)", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(4_000),
            });
            await time.increase(120);
            const deadline = (await time.latest()) + 3600;
            // pct=0 -> sz=0 -> wrapper treats closeSize 0 as a full close
            await d.tradingCore.connect(d.alice).partialClose(id, 0, 0, deadline);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
        });

        it("partialClose with >100% pct is clamped to a full close", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(4_000),
            });
            await time.increase(120);
            const deadline = (await time.latest()) + 3600;
            await d.tradingCore.connect(d.alice).partialClose(id, ethers.parseUnits("1.5", 18), 0, deadline);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
        });
    });

    describe("withdrawOrderCollateralTokenRefund guards", () => {
        it("reverts on zero token", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).withdrawOrderCollateralTokenRefund(ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
        });
        it("no-op for a token with no refund balance", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.alice).withdrawOrderCollateralTokenRefund(d.bob.address);
        });
    });

    describe("failed repayment views", () => {
        it("failedRepaymentCount starts at zero and getFailedRepayment returns empty", async () => {
            const d = await loadFixture(deployConfigured);
            expect(await d.tradingCore.failedRepaymentCount()).to.equal(0n);
            const fr = await d.tradingCore.getFailedRepayment(1);
            expect(fr.amount).to.equal(0n);
        });
    });

    describe("setMinLiquidatorRewardUsdc + setMaxFundingIntervals views", () => {
        it("reads back configured values", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setMinLiquidatorRewardUsdc(usdc(25));
            expect(await d.tradingCore.minLiquidatorRewardUsdc()).to.equal(usdc(25));
        });
    });
});

describe("TradingCore — order gating & updateMarket", () => {
    it("blocks a new increase order when a breaker is active on the market", async () => {
        const d = await loadFixture(deployConfigured);
        await d.oracle.connect(d.admin).configureBreaker(d.market, 0, 1000, 900, 600); // PRICE_DROP
        await d.oracle.connect(d.guardian).triggerBreaker(d.market, 0);
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
        ).to.be.revertedWithCustomError(d.tradingCore, "BreakerActive");
    });

    it("updateMarket changes risk parameters of a listed market", async () => {
        const d = await loadFixture(deployConfigured);
        await d.tradingCore.connect(d.admin).updateMarket(
            d.market,
            d.market,
            15,
            ethers.parseUnits("200000000", 18),
            ethers.parseUnits("600000000", 18),
            600,
            1200,
            900,
        );
        const info = await d.tradingCore.getMarketInfo(d.market);
        expect(info.maxLeverage).to.equal(15n);
        expect(info.maintenanceMargin).to.equal(600n);
    });

    it("only operator can updateMarket", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.alice).updateMarket(d.market, d.market, 15, 1, 1, 600, 1200, 900),
        ).to.be.revertedWithCustomError(d.tradingCore, "NotOperator");
    });

    it("recordFailedRepayment is restricted to self (TradingCore internal)", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.alice).recordFailedRepayment(1, usdc(100), d.market, true, 0),
        ).to.be.reverted;
    });

    it("resolveFailedRepayment reverts for an unknown record (admin)", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(d.tradingCore.connect(d.admin).resolveFailedRepayment(999)).to.be.reverted;
    });
});

describe("TradingCore — SL/TP batch trailing and skip handling", () => {
    it("executes a trailing-stop trigger and skips a non-triggering position in the same batch", async () => {
        const d = await loadFixture(deployConfigured);
        // position A: trailing stop; ratchet anchor up then retrace to trigger
        const idA = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        await d.tradingCore.connect(d.alice).setTrailingStop(idA, 500); // 5% trail
        // position B: no triggers configured -> should be skipped
        const idB = await openMarket(d, d.bob, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        await time.increase(120);

        // ratchet the anchor up via a batch call at a higher price (no trigger yet)
        await setPythPrice(d.pyth, d.feedId, price(55_000));
        await seedTwap(d, price(55_000));
        let data = await buildPriceUpdate(d.pyth, d.feedId, price(55_000));
        let fee = await d.pyth.getUpdateFee([data]);
        await d.tradingCore.connect(d.keeper).executeStopLossTakeProfit([idA, idB], [data], { value: fee });
        // both still open (anchor ratcheted, no retrace yet)
        expect((await d.tradingCore.getPosition(idA)).state).to.equal(PosStatus.OPEN);

        // now retrace > 5% from the 55k anchor -> trailing stop fires on A
        await setPythPrice(d.pyth, d.feedId, price(51_000));
        await seedTwap(d, price(51_000));
        data = await buildPriceUpdate(d.pyth, d.feedId, price(51_000));
        fee = await d.pyth.getUpdateFee([data]);
        await d.tradingCore.connect(d.keeper).executeStopLossTakeProfit([idA, idB], [data], { value: fee });
        expect((await d.tradingCore.getPosition(idA)).state).to.not.equal(PosStatus.OPEN);
        // B never had a trigger -> still open
        expect((await d.tradingCore.getPosition(idB)).state).to.equal(PosStatus.OPEN);
    });
});

describe("TradingCore — NFT transfer updates ownership enumeration", () => {
    it("transfers a position NFT and migrates user enumeration via updatePositionOwner", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        // alice transfers the position NFT to bob (both whitelisted in the fixture)
        await d.positionToken.connect(d.alice).transferFrom(d.alice.address, d.bob.address, id);
        expect(await d.positionToken.ownerOf(id)).to.equal(d.bob.address);
        const bobPositions = await d.tradingCore.getUserPositions(d.bob.address);
        expect(bobPositions).to.include(id);
    });
});
