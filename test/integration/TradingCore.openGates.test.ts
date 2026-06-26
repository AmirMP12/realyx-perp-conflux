import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, OrderType } from "../helpers/constants";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * Trips each risk gate in TradingLib._executeIncrease by configuring tight
 * limits then submitting orders that exceed them.
 */
describe("TradingCore — open-path risk gates (TradingLib._executeIncrease)", () => {
    it("reverts with ExceedsMaxPositionSize when size exceeds the market cap", async () => {
        const d = await loadFixture(deployConfigured);
        // shrink the per-position cap to 1,000 internal-precision units
        await d.tradingCore.connect(d.admin).updateMarket(
            d.market,
            d.market,
            20,
            ethers.parseUnits("1000", 18), // tiny maxPositionSize
            ethers.parseUnits("500000000", 18),
            500,
            1000,
            900,
        );
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
        });
        await expect(executeOrder(d, orderId)).to.be.reverted; // ExceedsMaxPositionSize
    });

    it("reverts with ExceedsMaxTotalExposure when market OI cap is breached", async () => {
        const d = await loadFixture(deployConfigured);
        await d.tradingCore.connect(d.admin).updateMarket(
            d.market,
            d.market,
            20,
            ethers.parseUnits("100000000", 18),
            ethers.parseUnits("1000", 18), // tiny maxTotalExposure
            500,
            1000,
            900,
        );
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
        });
        await expect(executeOrder(d, orderId)).to.be.reverted; // ExceedsMaxTotalExposure
    });

    it("reverts when the per-user exposure cap is exceeded", async () => {
        const d = await loadFixture(deployConfigured);
        // setLimits(uvl, gvl, lat, lai, mue, mpd): set a tiny max user exposure
        await d.tradingCore.connect(d.admin).setLimits(
            usdc(1_000_000_000),
            usdc(100_000_000_000),
            usdc(1_000_000_000),
            300,
            usdc(100), // maxUserExposure = 100 USDC
            30,
        );
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
        });
        await expect(executeOrder(d, orderId)).to.be.reverted; // ExceedsMaxTotalExposure (user)
    });

    it("reverts with slippage when a market-increase trigger deviates beyond maxSlippage", async () => {
        const d = await loadFixture(deployConfigured);
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
            triggerPrice: price(50_000),
            maxSlippage: 10, // 0.1%
        });
        // execute at a price ~6% away -> slippage revert
        await expect(executeOrder(d, orderId, price(53_000))).to.be.reverted; // SlippageExceeded
    });

    it("reverts opening with insufficient collateral to cover fee + margin", async () => {
        const d = await loadFixture(deployConfigured);
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(100_000),
            collateralDelta: usdc(10_001), // < initial margin for 100k notional at 10x
            isLong: true,
        });
        await expect(executeOrder(d, orderId)).to.be.reverted; // InsufficientCollateral / ExceedsMaxLeverage
    });
});

describe("TradingCore — stop-loss / take-profit at open (both sides)", () => {
    it("opens a long with valid SL below and TP above the price", async () => {
        const d = await loadFixture(deployConfigured);
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
            stopLossPrice: price(45_000),
            takeProfitPrice: price(60_000),
        });
        await executeOrder(d, orderId);
        const nextId = await d.tradingCore.nextPositionId();
        const pos = await d.tradingCore.getPosition(nextId - 1n);
        expect(pos.stopLossPrice).to.equal(price(45_000));
        expect(pos.takeProfitPrice).to.equal(price(60_000));
    });

    it("opens a short with valid SL above and TP below the price", async () => {
        const d = await loadFixture(deployConfigured);
        const orderId = await createOrder(d, d.bob, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: false,
            stopLossPrice: price(55_000),
            takeProfitPrice: price(40_000),
        });
        await executeOrder(d, orderId);
        const nextId = await d.tradingCore.nextPositionId();
        const pos = await d.tradingCore.getPosition(nextId - 1n);
        expect(pos.stopLossPrice).to.equal(price(55_000));
        expect(pos.takeProfitPrice).to.equal(price(40_000));
    });

    it("reverts opening a long with TP below price", async () => {
        const d = await loadFixture(deployConfigured);
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
            takeProfitPrice: price(45_000), // <= price -> invalid for long
        });
        await expect(executeOrder(d, orderId)).to.be.reverted;
    });

    it("reverts opening a short with SL below price", async () => {
        const d = await loadFixture(deployConfigured);
        const orderId = await createOrder(d, d.bob, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: false,
            stopLossPrice: price(45_000), // <= price -> invalid for short
        });
        await expect(executeOrder(d, orderId)).to.be.reverted;
    });

    it("reverts opening a short with TP above price", async () => {
        const d = await loadFixture(deployConfigured);
        const orderId = await createOrder(d, d.bob, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: false,
            takeProfitPrice: price(55_000), // >= price -> invalid for short
        });
        await expect(executeOrder(d, orderId)).to.be.reverted;
    });

    it("opens a low-leverage long where collateral >= size (no borrow path)", async () => {
        const d = await loadFixture(deployConfigured);
        // collateral >= notional -> borrowInternal == 0, borrow skipped
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(11_000),
            isLong: true,
        });
        await executeOrder(d, orderId);
        const nextId = await d.tradingCore.nextPositionId();
        expect((await d.tradingCore.getPosition(nextId - 1n)).state).to.equal(1); // OPEN
    });

    it("reverts when collateral barely covers only the fee (InsufficientCollateral)", async () => {
        const d = await loadFixture(deployConfigured);
        // collateral just above min size but below fee+margin for a large notional
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(1_000_000),
            collateralDelta: usdc(11),
            isLong: true,
        });
        await expect(executeOrder(d, orderId)).to.be.reverted;
    });
});

describe("TradingCore — open TWAP guards on a fresh market", () => {
    it("reverts opening against a cold TWAP buffer (twap not ready)", async () => {
        const d = await loadFixture(deployConfigured);
        const { setPythPrice } = await import("../helpers/pyth");
        const m = ethers.getAddress("0x00000000000000000000000000000000000000ac");
        const p = price(50_000);
        await d.oracle.setPythFeed(m, d.feedId, 900, 10n ** 15n);
        await d.oracle.addSupportedMarket(m);
        await d.oracle.setMarketId(m, "FRESH-USD");
        await d.marketCalendar.setMarketConfig("FRESH-USD", 0, 1439, 0, true);
        await setPythPrice(d.pyth, d.feedId, p);
        await d.tradingCore.setMarket(
            m,
            m,
            20,
            ethers.parseUnits("100000000", 18),
            ethers.parseUnits("500000000", 18),
            500,
            1000,
            900,
        );
        await d.tradingCore.setMarketId(m, "FRESH-USD");
        // no recordPricePoint -> cold buffer -> OpenPriceDeviation at execute
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            market: m,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
        });
        await expect(executeOrder(d, orderId)).to.be.reverted;
    });
});
