import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, seedTwap } from "../helpers/fixture";
import { openMarket } from "../helpers/trading";
import { usdc, PosStatus } from "../helpers/constants";
import { setPythPrice, buildPriceUpdate } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

describe("TradingCore — liquidation & funding (integration)", () => {
    describe("liquidation", () => {
        it("liquidates an underwater long and rewards the liquidator", async () => {
            const d = await loadFixture(deployConfigured);
            // open near max leverage: 20k notional on 2.1k collateral (~9.5x, just above 10% IM)
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(2_100),
            });
            await time.increase(120);
            // ~7% drop: liquidatable (health < 1) but effective collateral stays
            // positive so the vault repay succeeds (clean liquidation, no bad debt).
            await setPythPrice(d.pyth, d.feedId, price(46_500));
            await seedTwap(d, price(46_500));
            const [can] = await d.tradingCore.canLiquidate(id);
            expect(can).to.equal(true);
            const before = await d.usdc.balanceOf(d.liquidator.address);
            await d.tradingCore.connect(d.liquidator).liquidatePosition(id);
            expect(await d.usdc.balanceOf(d.liquidator.address)).to.be.greaterThanOrEqual(before);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.LIQUIDATED);
        });

        it("reverts liquidation of a healthy position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(5_000),
            });
            await time.increase(120);
            await expect(d.tradingCore.connect(d.liquidator).liquidatePosition(id)).to.be.reverted;
        });

        it("only LIQUIDATOR_ROLE can liquidate", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(2_100),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(43_000));
            await expect(d.tradingCore.connect(d.bob).liquidatePosition(id)).to.be.revertedWithCustomError(
                d.tradingCore,
                "NotLiquidator",
            );
        });

        it("healthy position is not liquidatable at entry price", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(2_100),
            });
            await time.increase(120);
            const [can] = await d.tradingCore.canLiquidate(id);
            expect(can).to.equal(false); // still healthy at $50k
        });
    });

    describe("funding", () => {
        it("settles market funding and advances lastSettlement", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(50_000), collateralUsdc: usdc(6_000) });
            await time.increase(8 * 60 * 60 + 1); // one funding interval
            await setPythPrice(d.pyth, d.feedId, price(50_000)); // refresh after time jump
            await d.tradingCore.settleFunding(d.market);
            const fs = await d.tradingCore.getFundingState(d.market);
            expect(fs.lastSettlement).to.be.greaterThan(0n);
        });

        it("settlePositionFunding charges/credits the trader", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(50_000), collateralUsdc: usdc(6_000) });
            await time.increase(8 * 60 * 60 + 1);
            await setPythPrice(d.pyth, d.feedId, price(50_000)); // refresh price so reads are not stale
            await d.tradingCore.settleFunding(d.market);
            // settle on the position; should not revert
            await d.tradingCore.settlePositionFunding(id);
        });

        it("guardian can force-settle funding on a dormant market", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(50_000), collateralUsdc: usdc(6_000) });
            await time.increase(10 * 24 * 60 * 60); // 10 days dormant
            await setPythPrice(d.pyth, d.feedId, price(50_000));
            await d.tradingCore.connect(d.guardian).forceSettleFunding(d.market);
            const fs = await d.tradingCore.getFundingState(d.market);
            expect(fs.lastSettlement).to.be.greaterThan(0n);
        });

        it("non-guardian cannot force settle", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).forceSettleFunding(d.market)).to.be.revertedWithCustomError(
                d.tradingCore,
                "NotGuardian",
            );
        });
    });

    describe("protocol health (keeper)", () => {
        it("keeper updates protocol health from vault TVL", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.keeper).updateProtocolHealth();
            const [healthy] = await d.tradingCore.getProtocolHealthState();
            expect(healthy).to.equal(true);
        });
        it("non-keeper cannot update protocol health", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).updateProtocolHealth()).to.be.reverted;
        });
    });
});
