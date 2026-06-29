import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, deployProtocol, seedTwap } from "../helpers/fixture";
import { openMarket } from "../helpers/trading";
import { usdc } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * Verifies TradingCoreViews against the wired deployConfigured fixture (and the
 * unseeded deployProtocol for the zero-TVL case):
 *   - re-initialization guard
 *   - protocol health reports a zero ratio on an empty vault
 *   - getPositionPnL / canLiquidate early-return for non-open positions
 *   - global unrealized PnL across a short-only market
 *   - short-position stop-loss and take-profit trigger evaluation
 */
describe("TradingCoreViews — initialize & protocol health", () => {
    it("initialize reverts when already initialized", async () => {
        const d = await loadFixture(deployConfigured);
        await expect(
            d.tradingViews.initialize(
                await d.tradingCore.getAddress(),
                await d.vault.getAddress(),
                await d.oracle.getAddress(),
            ),
        ).to.be.reverted;
    });

    it("getProtocolHealth reports zero ratio when the vault has no assets", async () => {
        // unseeded protocol -> vault.totalAssets() == 0
        const d = await loadFixture(deployProtocol);
        const [, badDebt, totalAssets, ratioBps] = await d.tradingViews.getProtocolHealth();
        expect(totalAssets).to.equal(0n);
        expect(badDebt).to.equal(0n);
        expect(ratioBps).to.equal(0n);
    });
});

describe("TradingCoreViews — non-open position early returns", () => {
    it("getPositionPnL(core,id) returns (0,0) for a non-open position", async () => {
        const d = await loadFixture(deployConfigured);
        const [pnl, hf] = await d.tradingViews.getPositionPnL(await d.tradingCore.getAddress(), 999);
        expect(pnl).to.equal(0n);
        expect(hf).to.equal(0n);
    });

    it("canLiquidate(core,id) returns (false, max) for a non-open position", async () => {
        const d = await loadFixture(deployConfigured);
        const [liq, hf] = await d.tradingViews.canLiquidate(await d.tradingCore.getAddress(), 999);
        expect(liq).to.equal(false);
        expect(hf).to.equal(ethers.MaxUint256);
    });

    it("getPositionPnL(core,id) values an open position", async () => {
        const d = await loadFixture(deployConfigured);
        // Refresh the TWAP ring buffer at the current block time so the open
        // path's 15-min TWAP-validity window is always satisfied regardless of
        // fixture-snapshot/time ordering across the suite.
        await seedTwap(d, price(50_000));
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
            execPrice: price(50_000),
        });
        await setPythPrice(d.pyth, d.feedId, price(51_000));
        const [pnl] = await d.tradingViews.getPositionPnL(await d.tradingCore.getAddress(), id);
        expect(typeof pnl).to.equal("bigint");
    });
});

describe("TradingCoreViews — short-position scenarios", () => {
    it("getGlobalUnrealizedPnLDetailed walks a short-only market", async () => {
        const d = await loadFixture(deployConfigured);
        await seedTwap(d, price(50_000));
        await openMarket(d, d.alice, {
            isLong: false,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
            execPrice: price(50_000),
        });
        await setPythPrice(d.pyth, d.feedId, price(50_000));
        const m = await d.tradingCore.getMarketInfo(d.market);
        expect(m.totalShortSize).to.be.greaterThan(0n);
        expect(m.totalLongSize).to.equal(0n);
        const [, complete] = await d.tradingViews.getGlobalUnrealizedPnLDetailed(
            await d.tradingCore.getAddress(),
        );
        expect(complete).to.equal(true);
    });

    it("flags a stop-loss trigger on a short when price rises above the stop", async () => {
        const d = await loadFixture(deployConfigured);
        await seedTwap(d, price(50_000));
        const id = await openMarket(d, d.alice, {
            isLong: false,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
            execPrice: price(50_000),
        });
        // short SL must sit ABOVE current price (validateStopLoss: sl > price)
        await d.tradingCore.connect(d.alice).setStopLoss(id, price(51_000));
        // push price above the SL so the short stop-loss triggers
        await setPythPrice(d.pyth, d.feedId, price(52_000));
        const [, , , , sl] = await d.tradingViews.getPositionHealth(id);
        expect(sl).to.equal(true);
    });

    it("flags a take-profit trigger on a short when price falls below the target", async () => {
        const d = await loadFixture(deployConfigured);
        await seedTwap(d, price(50_000));
        const id = await openMarket(d, d.alice, {
            isLong: false,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
            execPrice: price(50_000),
        });
        // short TP must sit BELOW current price (validateTakeProfit: tp < price)
        await d.tradingCore.connect(d.alice).setTakeProfit(id, price(49_000));
        // push price below the TP so the short take-profit triggers
        await setPythPrice(d.pyth, d.feedId, price(48_000));
        const [, , , , , tp] = await d.tradingViews.getPositionHealth(id);
        expect(tp).to.equal(true);
    });
});
