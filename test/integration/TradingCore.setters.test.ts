import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { openMarket, createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, OrderType } from "../helpers/constants";

const price = (n: number) => BigInt(n) * 10n ** 18n;

describe("TradingCore — setter bounds and execute gates", () => {
    describe("setLimits bounds", () => {
        it("rejects user daily volume below the floor", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setLimits(usdc(500), 0, 0, 0, 0, 0)).to.be.reverted;
        });
        it("rejects user daily volume above the ceiling", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setLimits(usdc(2_000_000_000), 0, 0, 0, 0, 0),
            ).to.be.reverted;
        });
        it("rejects large-action threshold out of range", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setLimits(0, 0, usdc(500), 0, 0, 0)).to.be.reverted;
            await expect(
                d.tradingCore.connect(d.admin).setLimits(0, 0, usdc(2_000_000_000), 0, 0, 0),
            ).to.be.reverted;
        });
        it("rejects large-action interval over 24h", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setLimits(0, 0, 0, 25 * 60 * 60, 0, 0)).to.be.reverted;
        });
        it("applies valid limits including minPositionDuration and maxUserExposure", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setLimits(
                usdc(2_000),
                usdc(10_000),
                usdc(2_000),
                3600,
                usdc(900_000_000),
                60,
            );
            expect(await d.tradingCore.minPositionDuration()).to.equal(60n);
        });
    });

    describe("setParams bounds", () => {
        it("rejects minInteractionDelay over 1 hour", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setParams(0, 0, 0, 0, 0, 2 * 60 * 60, 0)).to.be.reverted;
        });
        it("rejects maxPositionsPerUser over 500", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setParams(0, 0, 0, 0, 501, 0, 0)).to.be.reverted;
        });
        it("applies valid params (minExecutionFee, liquidationDeviationBps)", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setParams(usdc(10), 5n * 10n ** 17n, 1000, ethers.parseEther("0.01"), 200, 1, 500);
            expect(await d.tradingCore.minExecutionFee()).to.equal(ethers.parseEther("0.01"));
        });
    });

    describe("executeOrder gates", () => {
        it("reverts opening when maxPositionsPerUser is reached", async () => {
            const d = await loadFixture(deployConfigured);
            // cap at 1 position per user
            await d.tradingCore.connect(d.admin).setParams(0, 0, 0, 0, 1, 0, 0);
            await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            // second open should revert at execute (MaxPositionsExceeded)
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            await expect(executeOrder(d, orderId)).to.be.reverted;
        });

        it("enforces the large-action rate limit against the order owner at fill", async () => {
            const d = await loadFixture(deployConfigured);
            // small threshold so a normal order counts as "large"; short interval
            await d.tradingCore.connect(d.admin).setLimits(0, 0, usdc(1_000), 3600, 0, 0);
            await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(20_000), collateralUsdc: usdc(4_000) });
            // immediate second large open by the same owner trips the rate limit at fill
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(20_000),
                collateralDelta: usdc(4_000),
                isLong: true,
            });
            await expect(executeOrder(d, orderId)).to.be.reverted; // RateLimitExceeded
        });
    });

    describe("settlePositionFunding via decrease order path", () => {
        it("a limit-decrease order settles funding before reducing", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(4_000),
            });
            await time.increase(8 * 60 * 60 + 1);
            const { setPythPrice } = await import("../helpers/pyth");
            const { seedTwap } = await import("../helpers/fixture");
            await setPythPrice(d.pyth, d.feedId, price(50_000));
            await seedTwap(d, price(50_000));
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_DECREASE,
                sizeDelta: usdc(10_000),
                triggerPrice: price(50_000),
                isLong: true,
                isReduceOnly: true,
                positionId: id,
            });
            await executeOrder(d, orderId, price(50_500));
            expect((await d.tradingCore.getPosition(id)).size).to.be.lessThan(usdc(20_000) * 10n ** 12n + 1n);
        });
    });
});
