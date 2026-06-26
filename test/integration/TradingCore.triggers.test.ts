import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { openMarket } from "../helpers/trading";
import { usdc } from "../helpers/constants";

const price = (n: number) => BigInt(n) * 10n ** 18n;

describe("TradingCore — SL/TP/trailing validation (PositionTriggersLib)", () => {
    async function withLong() {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        return { d, id };
    }

    async function withShort() {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.bob, {
            isLong: false,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        return { d, id };
    }

    it("reverts setStopLoss above price for a long (invalid)", async () => {
        const { d, id } = await withLong();
        // long SL must be < price (50k); 55k is invalid
        await expect(d.tradingCore.connect(d.alice).setStopLoss(id, price(55_000))).to.be.reverted;
    });

    it("accepts a valid long stop-loss below price", async () => {
        const { d, id } = await withLong();
        await d.tradingCore.connect(d.alice).setStopLoss(id, price(45_000));
        expect((await d.tradingCore.getPosition(id)).stopLossPrice).to.equal(price(45_000));
    });

    it("reverts setTakeProfit below price for a long (invalid)", async () => {
        const { d, id } = await withLong();
        // long TP must be > price; 45k invalid
        await expect(d.tradingCore.connect(d.alice).setTakeProfit(id, price(45_000))).to.be.reverted;
    });

    it("reverts setStopLoss below price for a short (invalid)", async () => {
        const { d, id } = await withShort();
        // short SL must be > price; 45k invalid
        await expect(d.tradingCore.connect(d.bob).setStopLoss(id, price(45_000))).to.be.reverted;
    });

    it("accepts a valid short stop-loss above price", async () => {
        const { d, id } = await withShort();
        await d.tradingCore.connect(d.bob).setStopLoss(id, price(55_000));
        expect((await d.tradingCore.getPosition(id)).stopLossPrice).to.equal(price(55_000));
    });

    it("reverts setTakeProfit above price for a short (invalid)", async () => {
        const { d, id } = await withShort();
        await expect(d.tradingCore.connect(d.bob).setTakeProfit(id, price(55_000))).to.be.reverted;
    });

    it("setTakeProfit to 0 clears it", async () => {
        const { d, id } = await withLong();
        await d.tradingCore.connect(d.alice).setTakeProfit(id, price(60_000));
        await d.tradingCore.connect(d.alice).setTakeProfit(id, 0);
        expect((await d.tradingCore.getPosition(id)).takeProfitPrice).to.equal(0n);
    });

    it("setStopLoss to 0 clears it", async () => {
        const { d, id } = await withLong();
        await d.tradingCore.connect(d.alice).setStopLoss(id, price(45_000));
        await d.tradingCore.connect(d.alice).setStopLoss(id, 0);
        expect((await d.tradingCore.getPosition(id)).stopLossPrice).to.equal(0n);
    });

    it("reverts SL/TP/trailing from a non-owner", async () => {
        const { d, id } = await withLong();
        await expect(d.tradingCore.connect(d.bob).setStopLoss(id, price(45_000))).to.be.reverted;
        await expect(d.tradingCore.connect(d.bob).setTakeProfit(id, price(55_000))).to.be.reverted;
        await expect(d.tradingCore.connect(d.bob).setTrailingStop(id, 500)).to.be.reverted;
    });

    it("reverts setTrailingStop above the max bps", async () => {
        const { d, id } = await withLong();
        // MAX_TRAILING_BPS is bounded; a huge value must revert InvalidTrailingStop
        await expect(d.tradingCore.connect(d.alice).setTrailingStop(id, 60000)).to.be.reverted;
    });

    it("reverts SL/TP/trailing on a non-open position", async () => {
        const { d, id } = await withLong();
        await time.increase(120);
        await d.tradingCore.connect(d.alice).closePosition({
            positionId: id,
            closeSize: 0,
            minReceive: 0,
            deadline: (await time.latest()) + 3600,
        });
        await expect(d.tradingCore.connect(d.alice).setStopLoss(id, price(45_000))).to.be.reverted;
    });
});
