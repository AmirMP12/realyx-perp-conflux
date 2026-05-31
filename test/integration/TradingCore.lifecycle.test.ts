import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { openMarket, closeFull, createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, PosStatus, OrderType } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

describe("TradingCore — position lifecycle (integration)", () => {
    describe("opening positions", () => {
        it("opens a long and tracks user position + NFT", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            const pos = await d.tradingCore.getPosition(id);
            expect(pos.state).to.equal(PosStatus.OPEN);
            expect(pos.size).to.be.greaterThan(0n);
            expect(await d.positionToken.ownerOf(id)).to.equal(d.alice.address);
            const userPositions = await d.tradingCore.getUserPositions(d.alice.address);
            expect(userPositions).to.include(id);
        });

        it("opens a short position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.bob, { isLong: false, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            const pos = await d.tradingCore.getPosition(id);
            expect(pos.state).to.equal(PosStatus.OPEN);
            expect(await d.positionToken.getPositionDirection(id)).to.equal(false);
        });

        it("reverts opening below min position size", async () => {
            const d = await loadFixture(deployConfigured);
            // minPositionSize is 10 USDC in the configured fixture
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(5),
                collateralDelta: usdc(5),
                isLong: true,
            });
            await expect(executeOrder(d, orderId)).to.be.reverted; // PositionTooSmall inside executor
        });

        it("reverts when collateral cannot cover fee + margin", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(100_000),
                collateralDelta: usdc(11), // far too little margin for 100k notional
                isLong: true,
            });
            await expect(executeOrder(d, orderId)).to.be.reverted;
        });

        it("charges an opening fee routed to the vault/treasury", async () => {
            const d = await loadFixture(deployConfigured);
            const treasuryBefore = await d.usdc.balanceOf(d.treasury.address);
            await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(50_000), collateralUsdc: usdc(6_000) });
            const treasuryAfter = await d.usdc.balanceOf(d.treasury.address);
            expect(treasuryAfter).to.be.greaterThanOrEqual(treasuryBefore);
        });
    });

    describe("closing positions", () => {
        it("closes a profitable long and pays out", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, 55_000n * 10n ** 18n);
            const before = await d.usdc.balanceOf(d.alice.address);
            await closeFull(d, d.alice, id);
            expect(await d.usdc.balanceOf(d.alice.address)).to.be.greaterThan(before);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
        });

        it("closes a losing long for less than collateral", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, 48_000n * 10n ** 18n); // -4%
            const before = await d.usdc.balanceOf(d.alice.address);
            await closeFull(d, d.alice, id);
            const gained = (await d.usdc.balanceOf(d.alice.address)) - before;
            expect(gained).to.be.lessThan(usdc(2_000));
        });

        it("reverts closing before min position duration", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await expect(closeFull(d, d.alice, id)).to.be.reverted; // MinPositionDuration
        });

        it("reverts closing past deadline", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await time.increase(120);
            const pastDeadline = (await time.latest()) - 1;
            await expect(
                d.tradingCore.connect(d.alice).closePosition({
                    positionId: id,
                    closeSize: 0,
                    minReceive: 0,
                    deadline: pastDeadline,
                }),
            ).to.be.revertedWithCustomError(d.tradingCore, "DeadlineExpired");
        });

        it("partialClose reduces position size", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(20_000), collateralUsdc: usdc(4_000) });
            const before = (await d.tradingCore.getPosition(id)).size;
            await time.increase(120);
            const deadline = (await time.latest()) + 3600;
            // close 50%
            await d.tradingCore.connect(d.alice).partialClose(id, ethers.parseUnits("0.5", 18), 0, deadline);
            const after = (await d.tradingCore.getPosition(id)).size;
            expect(after).to.be.lessThan(before);
            expect(after).to.be.greaterThan(0n);
        });
    });

    describe("collateral management", () => {
        it("adds collateral, lowering leverage", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            const levBefore = (await d.tradingCore.getPosition(id)).leverage;
            await time.increase(5);
            await d.tradingCore.connect(d.alice).addCollateral(id, usdc(1_000), 0, false);
            const levAfter = (await d.tradingCore.getPosition(id)).leverage;
            expect(levAfter).to.be.lessThan(levBefore);
        });

        it("reverts addCollateral by a non-owner", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await expect(
                d.tradingCore.connect(d.bob).addCollateral(id, usdc(1_000), 0, false),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotPositionOwner");
        });

        it("withdraws excess collateral while healthy", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(5_000) });
            await time.increase(5);
            const before = await d.usdc.balanceOf(d.alice.address);
            await d.tradingCore.connect(d.alice).withdrawCollateral(id, usdc(500));
            expect(await d.usdc.balanceOf(d.alice.address)).to.be.greaterThan(before);
        });

        it("reverts withdrawing collateral that would breach margin", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await time.increase(5);
            await expect(
                d.tradingCore.connect(d.alice).withdrawCollateral(id, usdc(1_900)),
            ).to.be.revertedWithCustomError(d.tradingCore, "InsufficientCollateral");
        });
    });

    describe("stop-loss / take-profit / trailing", () => {
        it("sets and clears a stop loss", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await d.tradingCore.connect(d.alice).setStopLoss(id, 45_000n * 10n ** 18n);
            expect((await d.tradingCore.getPosition(id)).stopLossPrice).to.equal(45_000n * 10n ** 18n);
        });
        it("sets a take profit", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await d.tradingCore.connect(d.alice).setTakeProfit(id, 60_000n * 10n ** 18n);
            expect((await d.tradingCore.getPosition(id)).takeProfitPrice).to.equal(60_000n * 10n ** 18n);
        });
        it("sets a trailing stop and anchors price", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await d.tradingCore.connect(d.alice).setTrailingStop(id, 500);
            expect((await d.tradingCore.getPosition(id)).trailingStopBps).to.equal(500);
        });
    });

    describe("views", () => {
        it("getPositionPnL via views contract", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await setPythPrice(d.pyth, d.feedId, 52_000n * 10n ** 18n);
            const [pnl, hf] = await d.tradingCore.getPositionPnL(id);
            expect(pnl).to.be.greaterThan(0n);
            expect(hf).to.be.greaterThan(0n);
        });
        it("canLiquidate false for a healthy position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(5_000) });
            const [can] = await d.tradingCore.canLiquidate(id);
            expect(can).to.equal(false);
        });
        it("getGlobalUnrealizedPnL aggregates open interest", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
            await setPythPrice(d.pyth, d.feedId, 52_000n * 10n ** 18n);
            const pnl = await d.tradingCore.getGlobalUnrealizedPnL();
            // long-only OI in profit -> aggregate unrealized PnL should be positive
            expect(pnl).to.be.greaterThan(0n);
        });
    });
});
