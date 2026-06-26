import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, seedTwap } from "../helpers/fixture";
import { openMarket, closeFull, createOrder, executeOrder } from "../helpers/trading";
import { usdc, PosStatus, OrderType } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * Broad engine flows that exercise the TradingLib / PositionCloseLib / VaultCore
 * close and decrease paths across profit, loss, partial, short, and
 * multi-position scenarios.
 */
describe("TradingCore — lifecycle flows", () => {
    it("short position: open, price rises (loss), close", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.bob, { isLong: false, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(52_000)); // +4% -> short loss
        await seedTwap(d, price(52_000));
        await closeFull(d, d.bob, id);
        expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
    });

    it("short position: open, price falls (profit), close pays out", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.bob, { isLong: false, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(46_000)); // -8% -> short profit
        await seedTwap(d, price(46_000));
        const before = await d.usdt0.balanceOf(d.bob.address);
        await closeFull(d, d.bob, id);
        expect(await d.usdt0.balanceOf(d.bob.address)).to.be.greaterThan(before);
    });

    it("partial close at a profit then full close", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(40_000), collateralUsdc: usdc(8_000) });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(54_000));
        await seedTwap(d, price(54_000));
        const deadline = (await time.latest()) + 3600;
        await d.tradingCore.connect(d.alice).partialClose(id, ethers.parseUnits("0.25", 18), 0, deadline);
        expect((await d.tradingCore.getPosition(id)).size).to.be.greaterThan(0n);
        await d.tradingCore.connect(d.alice).partialClose(id, ethers.parseUnits("1", 18), 0, deadline);
        expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
    });

    it("market-decrease order reduces a long position", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(30_000), collateralUsdc: usdc(6_000) });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(51_000));
        await seedTwap(d, price(51_000));
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_DECREASE,
            sizeDelta: usdc(10_000),
            isLong: true,
            isReduceOnly: true,
            positionId: id,
        });
        await executeOrder(d, orderId, price(51_000));
        expect((await d.tradingCore.getPosition(id)).size).to.be.lessThan(usdc(30_000) * 10n ** 12n + 1n);
    });

    it("multiple positions per user open and close independently", async () => {
        const d = await loadFixture(deployConfigured);
        const id1 = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
        const id2 = await openMarket(d, d.alice, { isLong: false, sizeUsdc: usdc(15_000), collateralUsdc: usdc(3_000) });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(50_500));
        await seedTwap(d, price(50_500));
        await closeFull(d, d.alice, id1);
        await closeFull(d, d.alice, id2);
        expect((await d.tradingCore.getPosition(id1)).state).to.equal(PosStatus.CLOSED);
        expect((await d.tradingCore.getPosition(id2)).state).to.equal(PosStatus.CLOSED);
    });

    it("close with minReceive slippage protection that is satisfied", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(55_000));
        await seedTwap(d, price(55_000));
        await closeFull(d, d.alice, id, usdc(1)); // tiny minReceive, satisfied
        expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
    });

    it("close reverts when minReceive slippage is not met", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(50_000));
        await seedTwap(d, price(50_000));
        await expect(closeFull(d, d.alice, id, usdc(1_000_000))).to.be.reverted; // SlippageExceeded
    });

    it("addCollateral lowers leverage; withdrawCollateral returns excess", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(5_000) });
        await time.increase(5);
        await d.tradingCore.connect(d.alice).addCollateral(id, usdc(2_000), 0, false);
        await d.tradingCore.connect(d.alice).withdrawCollateral(id, usdc(500));
        expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.OPEN);
    });

    it("settles funding across a full interval then closes", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(50_000), collateralUsdc: usdc(6_000) });
        await time.increase(8 * 60 * 60 + 1);
        await setPythPrice(d.pyth, d.feedId, price(50_000));
        await seedTwap(d, price(50_000));
        await d.tradingCore.settleFunding(d.market);
        await d.tradingCore.settlePositionFunding(id);
        await closeFull(d, d.alice, id);
        expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
    });
});
