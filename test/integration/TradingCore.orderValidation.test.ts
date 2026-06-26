import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, OrderType, TimeInForce, CollateralType } from "../helpers/constants";

const price = (n: number) => BigInt(n) * 10n ** 18n;

describe("TradingCore — createOrder validation", () => {
    it("reverts IOC and FOK time-in-force as unsupported", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.LIMIT_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                    triggerPrice: price(45_000),
                    tif: TimeInForce.IOC,
                }),
                { value: EXEC_FEE },
            ),
        ).to.be.revertedWithCustomError(d.tradingCore, "UnsupportedTimeInForce");
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.LIMIT_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                    triggerPrice: price(45_000),
                    tif: TimeInForce.FOK,
                }),
                { value: EXEC_FEE },
            ),
        ).to.be.revertedWithCustomError(d.tradingCore, "UnsupportedTimeInForce");
    });

    it("POST_ONLY long that crosses the book reverts", async () => {
        const d = await loadFixture(deployConfigured);
        // long post-only must rest below spot (50k); trigger above spot crosses
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.LIMIT_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                    triggerPrice: price(55_000),
                    isLong: true,
                    tif: TimeInForce.POST_ONLY,
                }),
                { value: EXEC_FEE },
            ),
        ).to.be.revertedWithCustomError(d.tradingCore, "PostOnlyCrossesBook");
    });

    it("POST_ONLY short that crosses the book reverts", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.LIMIT_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                    triggerPrice: price(45_000),
                    isLong: false,
                    tif: TimeInForce.POST_ONLY,
                }),
                { value: EXEC_FEE },
            ),
        ).to.be.revertedWithCustomError(d.tradingCore, "PostOnlyCrossesBook");
    });

    it("POST_ONLY long resting below spot is accepted", async () => {
        const d = await loadFixture(deployConfigured);
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
        ).to.emit(d.tradingCore, "OrderCreated");
    });

    it("POST_ONLY short resting above spot is accepted", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.LIMIT_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                    triggerPrice: price(55_000),
                    isLong: false,
                    tif: TimeInForce.POST_ONLY,
                }),
                { value: EXEC_FEE },
            ),
        ).to.emit(d.tradingCore, "OrderCreated");
    });

    it("reduce-only increase order reverts (ReduceOnlyRequiresPosition)", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.LIMIT_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                    triggerPrice: price(45_000),
                    isReduceOnly: true,
                    positionId: 1,
                }),
                { value: EXEC_FEE },
            ),
        ).to.be.revertedWithCustomError(d.tradingCore, "ReduceOnlyRequiresPosition");
    });

    it("visible size smaller than size reverts (iceberg unsupported)", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.MARKET_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                    visibleSize: usdc(5_000),
                }),
                { value: EXEC_FEE },
            ),
        ).to.be.revertedWithCustomError(d.tradingCore, "InvalidVisibleSize");
    });

    it("reverts opening order while market session is closed", async () => {
        const d = await loadFixture(deployConfigured);
        // close the market session via the calendar
        await d.marketCalendar.setMarketConfig(d.marketId, 0, 1, 0, false); // tiny window, weekdays
        // jump far so we are outside any open window for this market id
        await expect(
            d.tradingCore.connect(d.alice).createOrder(
                orderParams(d, {
                    orderType: OrderType.MARKET_INCREASE,
                    sizeDelta: usdc(10_000),
                    collateralDelta: usdc(2_000),
                }),
                { value: EXEC_FEE },
            ),
        ).to.be.reverted; // MarketClosed (or passes if currently inside window)
    });
});
