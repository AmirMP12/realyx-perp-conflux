import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, seedTwap } from "../helpers/fixture";
import { openMarket, createOrder, executeOrder } from "../helpers/trading";
import { usdc, OrderType, PosStatus } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * Tests for configurable risk-control features. Each toggle defaults OFF so
 * legacy behaviour (and the rest of the suite) is unchanged; these specs assert
 * the new gated behaviour once governance opts in.
 */
describe("Risk control features", () => {
    describe("risk parameter bounds", () => {
        it("setThresholds enforces restriction < emergency <= BPS", async () => {
            const d = await loadFixture(deployConfigured);
            // emergency below restriction -> revert
            await expect(d.vault.connect(d.admin).setThresholds(9000, 8000)).to.be.revertedWithCustomError(
                d.vault,
                "InvalidRequest",
            );
            // emergency over 100% -> revert
            await expect(d.vault.connect(d.admin).setThresholds(7500, 10001)).to.be.revertedWithCustomError(
                d.vault,
                "InvalidRequest",
            );
            // zero restriction -> revert
            await expect(d.vault.connect(d.admin).setThresholds(0, 9000)).to.be.revertedWithCustomError(
                d.vault,
                "InvalidRequest",
            );
            // valid ordering succeeds
            await expect(d.vault.connect(d.admin).setThresholds(8000, 9500)).to.emit(d.vault, "ThresholdsUpdated");
        });

        it("setLimits rejects an absurd maxUserExposure but accepts sane values", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setLimits(0, 0, 0, 0, usdc(20_000_000_000), 0),
            ).to.be.reverted;
            // a large-but-bounded value still applies
            await d.tradingCore.connect(d.admin).setLimits(0, 0, 0, 0, usdc(900_000_000), 0);
            expect(await d.tradingCore.maxUserExposure()).to.equal(usdc(900_000_000));
        });
    });

    describe("execution price age bound", () => {
        it("ships a sane default (15 min) for the execution-price staleness bound", async () => {
            const d = await loadFixture(deployConfigured);
            // the bound now defaults to the 15-minute oracle staleness
            // window instead of 0 (disabled), capping keeper price selection.
            expect(await d.tradingCore.maxExecutionPriceAge()).to.equal(15n * 60n);
        });

        it("bounds and applies the configured age", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(2 * 60 * 60),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidParam");
            await expect(d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(300)).to.emit(
                d.tradingCore,
                "MaxExecutionPriceAgeUpdated",
            );
            expect(await d.tradingCore.maxExecutionPriceAge()).to.equal(300n);
        });

        it("rejects executing an order against a stale price when the bound is set", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(60);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            // let the pushed price age beyond the 60s bound, then execute with no
            // fresh price update -> stale -> revert
            await time.increase(120);
            await expect(executeOrder(d, orderId)).to.be.reverted;
        });

        it("allows execution with a fresh price update under the bound", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(600);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            // push a fresh price at execution time
            await executeOrder(d, orderId, price(50_000));
        });

        it("only admin can set the price age", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).setMaxExecutionPriceAge(300)).to.be.revertedWithCustomError(
                d.tradingCore,
                "NotAdmin",
            );
        });
    });

    describe("permissionless liquidation backstop", () => {
        it("is disabled by default and reverts for a non-liquidator", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(2_100),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(46_500));
            await seedTwap(d, price(46_500));
            await expect(
                d.tradingCore.connect(d.bob).liquidatePositionPermissionless(id),
            ).to.be.revertedWithCustomError(d.tradingCore, "Unauthorized");
        });

        it("allows anyone to liquidate once governance enables it", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setPermissionlessLiquidation(true)).to.emit(
                d.tradingCore,
                "PermissionlessLiquidationUpdated",
            );
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(20_000),
                collateralUsdc: usdc(2_100),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(46_500));
            await seedTwap(d, price(46_500));
            // d.bob holds no LIQUIDATOR_ROLE but can now liquidate
            await d.tradingCore.connect(d.bob).liquidatePositionPermissionless(id);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.LIQUIDATED);
        });

        it("still enforces health: cannot liquidate a healthy position", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setPermissionlessLiquidation(true);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(5_000),
            });
            await time.increase(120);
            await expect(d.tradingCore.connect(d.bob).liquidatePositionPermissionless(id)).to.be.reverted;
        });

        it("only admin toggles the flag", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).setPermissionlessLiquidation(true),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotAdmin");
        });
    });

    describe("closed-session liquidation policy", () => {
        // Wire a fresh weekday-only equity market that is currently CLOSED.
        async function closedMarket(d: any) {
            const m = ethers.getAddress("0x00000000000000000000000000000000000000c1");
            const mId = "EQ-CLOSED";
            const px = price(50_000);
            await d.oracle.setPythFeed(m, d.feedId, 900, 10n ** 15n);
            await d.oracle.addSupportedMarket(m);
            await d.oracle.setMarketId(m, mId);
            // open all-day on weekdays, closed weekends -> we then close every day
            // we can to force a closed session deterministically via a holiday.
            await d.marketCalendar.setMarketConfig(mId, 0, 1439, 0, false);
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
            await d.tradingCore.setMarketId(m, mId);
            // seed TWAP on the new market
            for (let i = 0; i < 4; i++) {
                await setPythPrice(d.pyth, d.feedId, px);
                await d.oracle.connect(d.oracleBot).recordPricePoint(m, 0);
                await time.increase(35);
            }
            await setPythPrice(d.pyth, d.feedId, px);
            return { m, mId };
        }

        it("liquidation reverts on a closed-session market by default", async () => {
            const d = await loadFixture(deployConfigured);
            // Determinism: the market below is weekday-only, so opening a
            // position would fail with MarketClosed if the EVM clock happens to
            // land on a weekend. Advance to the next UTC weekday before seeding
            // TWAP / opening so this spec is independent of the real calendar
            // day it runs on.
            {
                const dow = new Date((await time.latest()) * 1000).getUTCDay(); // 0=Sun,6=Sat
                if (dow === 0) await time.increase(24 * 3600);
                else if (dow === 6) await time.increase(2 * 24 * 3600);
            }
            const { m, mId } = await closedMarket(d);
            // open while open (mark today open), then mark closed via holiday
            const nextId = await d.tradingCore.nextPositionId();
            const orderId = await createOrder(d, d.alice, {
                market: m,
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(20_000),
                collateralDelta: usdc(2_100),
                isLong: true,
            });
            // ensure currently open: set today as a trading day window covering now is implied by 0..1439
            await executeOrder(d, orderId);
            const id = nextId;

            // Now force the session closed: set a holiday for "today" in the
            // market's local date.
            const nowTs = await time.latest();
            const dateY = new Date(nowTs * 1000);
            const yyyymmdd =
                dateY.getUTCFullYear() * 10000 + (dateY.getUTCMonth() + 1) * 100 + dateY.getUTCDate();
            await d.marketCalendar.setHoliday(mId, yyyymmdd, true);

            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(46_500));
            // liquidation should revert: market closed
            await expect(d.tradingCore.connect(d.liquidator).liquidatePosition(id)).to.be.reverted;
        });

        it("admin can enable bounded closed-session liquidation", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setClosedSessionLiquidation(true)).to.emit(
                d.tradingCore,
                "ClosedSessionLiquidationUpdated",
            );
            expect(await d.tradingCore.closedSessionLiquidationEnabled()).to.equal(true);
        });

        it("only admin toggles the flag", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).setClosedSessionLiquidation(true),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotAdmin");
        });
    });
});
