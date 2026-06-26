import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { openMarket } from "../helpers/trading";
import { usdc, BreakerType } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

describe("TradingCoreViews — wired views (integration)", () => {
    it("getProtocolHealth aggregates vault TVL, bad debt ratio and global PnL", async () => {
        const d = await loadFixture(deployConfigured);
        const [healthy, badDebt, totalAssets, ratioBps] = await d.tradingViews.getProtocolHealth();
        expect(totalAssets).to.be.greaterThan(0n); // LP seeded 5M in the fixture
        expect(badDebt).to.equal(0n);
        expect(ratioBps).to.equal(0n);
    });

    it("getCircuitBreakerStatus reflects an unrestricted market and global pause flag", async () => {
        const d = await loadFixture(deployConfigured);
        const [restricted, active, globalPause] = await d.tradingViews.getCircuitBreakerStatus(d.market);
        expect(restricted).to.equal(false);
        expect(active).to.equal(0n);
        expect(globalPause).to.equal(false);
    });

    it("getCircuitBreakerStatus reflects a triggered breaker", async () => {
        const d = await loadFixture(deployConfigured);
        await d.oracle.connect(d.admin).configureBreaker(d.market, BreakerType.PRICE_DROP, 1000, 900, 600);
        await d.oracle.connect(d.guardian).triggerBreaker(d.market, BreakerType.PRICE_DROP);
        const [restricted, active] = await d.tradingViews.getCircuitBreakerStatus(d.market);
        expect(restricted).to.equal(true);
        expect(active).to.be.greaterThan(0n);
    });

    it("getPositionHealth returns live health for an open position", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        await setPythPrice(d.pyth, d.feedId, price(52_000));
        const [isLiq, hf, pnl, currentPrice] = await d.tradingViews.getPositionHealth(id);
        expect(isLiq).to.equal(false);
        expect(hf).to.be.greaterThan(0n);
        expect(pnl).to.be.greaterThan(0n);
        expect(currentPrice).to.equal(price(52_000));
    });

    it("getPositionHealth returns sentinel for a non-open position", async () => {
        const d = await loadFixture(deployConfigured);
        // position id 999 never opened -> NONE state
        const [isLiq, hf, pnl, currentPrice, sl, tp] = await d.tradingViews.getPositionHealth(999);
        expect(isLiq).to.equal(false);
        expect(hf).to.equal(ethers.MaxUint256);
        expect(pnl).to.equal(0n);
        expect(currentPrice).to.equal(0n);
        expect(sl).to.equal(false);
        expect(tp).to.equal(false);
    });

    it("getPositionHealth flags a triggered stop-loss", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        await d.tradingCore.connect(d.alice).setStopLoss(id, price(49_000));
        await setPythPrice(d.pyth, d.feedId, price(48_000)); // below SL
        const [, , , , sl] = await d.tradingViews.getPositionHealth(id);
        expect(sl).to.equal(true);
    });

    it("getPositionHealth flags a triggered take-profit", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        await d.tradingCore.connect(d.alice).setTakeProfit(id, price(52_000));
        await setPythPrice(d.pyth, d.feedId, price(53_000)); // above TP
        const [, , , , , tp] = await d.tradingViews.getPositionHealth(id);
        expect(tp).to.equal(true);
    });
});
