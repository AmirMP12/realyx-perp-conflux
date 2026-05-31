import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { PRECISION, BPS } from "../helpers/constants";

/**
 * Exhaustive unit + branch coverage for PositionMath via the
 * FeeCalculatorPositionMathHarness wrapper. Every branch in each pure
 * function is exercised, plus property/fuzz-style sweeps.
 */
async function deployHarness() {
    const H = await ethers.getContractFactory("FeeCalculatorPositionMathHarness");
    const h = await H.deploy();
    await h.waitForDeployment();
    return h;
}

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

describe("PositionMath (unit + branches)", () => {
    describe("calculateUnrealizedPnL", () => {
        it("returns 0 when size is 0 (early branch)", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcPnL(0, e18(100), e18(200), true)).to.equal(0n);
        });

        it("reverts when entryPrice is 0 and size > 0", async () => {
            const h = await loadFixture(deployHarness);
            await expect(h.calcPnL(e18(1), 0, e18(200), true)).to.be.revertedWithCustomError(h, "InvalidPrice");
        });

        it("long profit when current > entry", async () => {
            const h = await loadFixture(deployHarness);
            // size 1000e18, entry 100, current 120 => +20%
            const pnl = await h.calcPnL(e18(1000), e18(100), e18(120), true);
            expect(pnl).to.equal(e18(200));
        });

        it("long loss when current < entry", async () => {
            const h = await loadFixture(deployHarness);
            const pnl = await h.calcPnL(e18(1000), e18(100), e18(80), true);
            expect(pnl).to.equal(-e18(200));
        });

        it("long break-even when current == entry", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcPnL(e18(1000), e18(100), e18(100), true)).to.equal(0n);
        });

        it("short profit when current < entry", async () => {
            const h = await loadFixture(deployHarness);
            const pnl = await h.calcPnL(e18(1000), e18(100), e18(80), false);
            expect(pnl).to.equal(e18(200));
        });

        it("short loss when current > entry", async () => {
            const h = await loadFixture(deployHarness);
            const pnl = await h.calcPnL(e18(1000), e18(100), e18(120), false);
            expect(pnl).to.equal(-e18(200));
        });

        it("short break-even when current == entry", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcPnL(e18(1000), e18(100), e18(100), false)).to.equal(0n);
        });

        it("property: long pnl == -short pnl for symmetric moves", async () => {
            const h = await loadFixture(deployHarness);
            for (const cur of [50, 75, 90, 110, 150, 200]) {
                const long = await h.calcPnL(e18(1000), e18(100), e18(cur), true);
                const short = await h.calcPnL(e18(1000), e18(100), e18(cur), false);
                expect(long).to.equal(-short);
            }
        });
    });

    describe("calculateRealizedPnL", () => {
        it("subtracts fee and funding from unrealized", async () => {
            const h = await loadFixture(deployHarness);
            // unrealized 100, fee 10, funding 5 => 85
            expect(await h.calcRealizedPnL(e18(100), e18(10), e18(5))).to.equal(e18(85));
        });
        it("handles negative funding (trader receives)", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcRealizedPnL(e18(100), e18(10), -e18(5))).to.equal(e18(95));
        });
    });

    describe("calculatePnLPercent", () => {
        it("reverts on zero collateral (DivisionByZero)", async () => {
            const h = await loadFixture(deployHarness);
            await expect(h.calcPnLPercent(e18(1), 0)).to.be.revertedWithCustomError(h, "DivisionByZero");
        });
        it("computes signed percentage in 1e18", async () => {
            const h = await loadFixture(deployHarness);
            // pnl 50, collateral 100 => 0.5e18
            expect(await h.calcPnLPercent(e18(50), e18(100))).to.equal(PRECISION / 2n);
            expect(await h.calcPnLPercent(-e18(50), e18(100))).to.equal(-(PRECISION / 2n));
        });
    });

    describe("calculateInitialMargin", () => {
        it("reverts on zero leverage", async () => {
            const h = await loadFixture(deployHarness);
            await expect(h.calcInitialMargin(e18(1000), 0)).to.be.revertedWithCustomError(h, "InvalidLeverage");
        });
        it("margin = size / leverage", async () => {
            const h = await loadFixture(deployHarness);
            // leverage encoded in 1e18 (10x => 10e18) => size * 1e18 / 10e18 = size/10
            expect(await h.calcInitialMargin(e18(1000), e18(10))).to.equal(e18(100));
        });
    });

    describe("calculateMaintenanceMargin", () => {
        it("uses floor of 100 bps when below minimum", async () => {
            const h = await loadFixture(deployHarness);
            // bps 50 < 100 floor => effective 100 bps of 1000 = 10
            expect(await h.calcMaintenanceMargin(e18(1000), 50)).to.equal(e18(10));
        });
        it("uses provided bps when above minimum", async () => {
            const h = await loadFixture(deployHarness);
            // 500 bps of 1000 = 50
            expect(await h.calcMaintenanceMargin(e18(1000), 500)).to.equal(e18(50));
        });
    });

    describe("calculateDynamicMaintenanceMargin", () => {
        it("base 5% for leverage <= 5x", async () => {
            const h = await loadFixture(deployHarness);
            // leverage 3 (in 1e18) -> leverageMultiplier = 3 -> base 500 bps
            expect(await h.calcDynamicMM(e18(1000), e18(3))).to.equal(e18(50));
        });
        it("adds margin above 5x", async () => {
            const h = await loadFixture(deployHarness);
            // leverage 15 -> additional = ((15-5)/5)*50 = 100 bps -> total 600 bps
            expect(await h.calcDynamicMM(e18(1000), e18(15))).to.equal(e18(60));
        });
        it("caps at 20% (2000 bps) for extreme leverage", async () => {
            const h = await loadFixture(deployHarness);
            // leverage 1000 -> additional huge -> capped at 2000 bps => 200
            expect(await h.calcDynamicMM(e18(1000), e18(1000))).to.equal(e18(200));
        });
    });

    describe("calculateLiquidationPrice", () => {
        it("reverts on zero entry price", async () => {
            const h = await loadFixture(deployHarness);
            await expect(h.calcLiqPrice(0, e18(10), e18(1000), true)).to.be.revertedWithCustomError(h, "InvalidPrice");
        });
        it("reverts on zero leverage", async () => {
            const h = await loadFixture(deployHarness);
            await expect(h.calcLiqPrice(e18(100), 0, e18(1000), true)).to.be.revertedWithCustomError(
                h,
                "InvalidLeverage",
            );
        });
        it("long liquidation price is below entry", async () => {
            const h = await loadFixture(deployHarness);
            const lp = await h.calcLiqPrice(e18(100), e18(10), e18(1000), true);
            expect(lp).to.be.greaterThan(0n);
            expect(lp).to.be.lessThan(e18(100));
        });
        it("short liquidation price is above entry", async () => {
            const h = await loadFixture(deployHarness);
            const lp = await h.calcLiqPrice(e18(100), e18(10), e18(1000), false);
            expect(lp).to.be.greaterThan(e18(100));
        });
        it("returns sentinel (uint128 max) for very low long leverage with tiny size", async () => {
            const h = await loadFixture(deployHarness);
            // With size 0, mmFraction = DEFAULT/BPS = 0.05e18; at leverage 1x, inverseL=1e18.
            // PRECISION(1e18)+0.05e18 > 1e18, so NOT sentinel. To force the sentinel branch
            // (PRECISION + mmFraction <= inverseL) we need leverage < 1x where inverseL > 1e18.
            // leverage 0.5x (5e17) => inverseL = 2e18 >= 1.05e18 -> sentinel.
            const lp = await h.calcLiqPrice(e18(100), e18(1) / 2n, e18(1000), true);
            expect(lp).to.equal((1n << 128n) - 1n);
        });
    });

    describe("calculateFundingRate", () => {
        it("returns 0 when total OI is 0", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcFundingRate(0, 0, e18(1))).to.equal(0n);
        });
        it("positive when longs dominate", async () => {
            const h = await loadFixture(deployHarness);
            const r = await h.calcFundingRate(e18(2000), e18(1000), 10n ** 14n);
            expect(r).to.be.greaterThan(0n);
        });
        it("negative when shorts dominate", async () => {
            const h = await loadFixture(deployHarness);
            const r = await h.calcFundingRate(e18(1000), e18(2000), 10n ** 14n);
            expect(r).to.be.lessThan(0n);
        });
        it("zero when balanced", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcFundingRate(e18(1000), e18(1000), 10n ** 14n)).to.equal(0n);
        });
    });

    describe("calculateFundingOwed", () => {
        it("returns 0 for zero size", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcFundingOwed(0, 1, e18(1))).to.equal(0n);
        });
        it("returns 0 for zero delta", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcFundingOwed(e18(1000), 1, 0)).to.equal(0n);
        });
        it("long owes positive funding when delta positive", async () => {
            const h = await loadFixture(deployHarness);
            const owed = await h.calcFundingOwed(e18(1000), 1, e18(1) / 100n);
            expect(owed).to.be.greaterThan(0n);
        });
        it("short receives (negative) when delta positive", async () => {
            const h = await loadFixture(deployHarness);
            const owed = await h.calcFundingOwed(e18(1000), 0, e18(1) / 100n);
            expect(owed).to.be.lessThan(0n);
        });
    });

    describe("calculateFundingIntervals", () => {
        it("returns 0 when currentTime <= lastSettlement", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcFundingIntervals(1000, 1000, 100)).to.equal(0n);
            expect(await h.calcFundingIntervals(1000, 900, 100)).to.equal(0n);
        });
        it("returns 0 when interval is 0", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcFundingIntervals(1000, 2000, 0)).to.equal(0n);
        });
        it("computes whole intervals elapsed", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcFundingIntervals(1000, 1000 + 350, 100)).to.equal(3n);
        });
    });

    describe("validateSlippage", () => {
        it("returns false on zero expected price", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.validateSlippage(0, e18(100), 100, true)).to.equal(false);
        });
        it("long: accepts actual within +slippage", async () => {
            const h = await loadFixture(deployHarness);
            // 1% slippage on 100 => max 101
            expect(await h.validateSlippage(e18(100), e18(101), 100, true)).to.equal(true);
            expect(await h.validateSlippage(e18(100), e18(102), 100, true)).to.equal(false);
        });
        it("short: accepts actual above -slippage", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.validateSlippage(e18(100), e18(99), 100, false)).to.equal(true);
            expect(await h.validateSlippage(e18(100), e18(98), 100, false)).to.equal(false);
        });
    });

    describe("stop-loss / take-profit triggers", () => {
        it("SL: disabled when stopLossPrice is 0", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.trigSL(true, 0, e18(50))).to.equal(false);
        });
        it("SL long: triggers when price <= stop", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.trigSL(true, e18(90), e18(89))).to.equal(true);
            expect(await h.trigSL(true, e18(90), e18(91))).to.equal(false);
        });
        it("SL short: triggers when price >= stop", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.trigSL(false, e18(110), e18(111))).to.equal(true);
            expect(await h.trigSL(false, e18(110), e18(109))).to.equal(false);
        });
        it("TP: disabled when takeProfitPrice is 0", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.trigTP(true, 0, e18(200))).to.equal(false);
        });
        it("TP long: triggers when price >= tp", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.trigTP(true, e18(120), e18(121))).to.equal(true);
            expect(await h.trigTP(true, e18(120), e18(119))).to.equal(false);
        });
        it("TP short: triggers when price <= tp", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.trigTP(false, e18(80), e18(79))).to.equal(true);
            expect(await h.trigTP(false, e18(80), e18(81))).to.equal(false);
        });
    });

    describe("isLiquidatable", () => {
        it("not liquidatable when position is not OPEN", async () => {
            const h = await loadFixture(deployHarness);
            const [liq, hf] = await h.isLiquidatableClosed(e18(1000), e18(100), 1, e18(100), e18(100));
            expect(liq).to.equal(false);
            expect(hf).to.equal(ethers.MaxUint256);
        });
        it("not liquidatable on zero current price", async () => {
            const h = await loadFixture(deployHarness);
            const [liq, hf] = await h.isLiquidatable(e18(1000), e18(100), 1, e18(10), 0, e18(100));
            expect(liq).to.equal(false);
            expect(hf).to.equal(ethers.MaxUint256);
        });
        it("liquidatable when effective collateral wiped by loss", async () => {
            const h = await loadFixture(deployHarness);
            // long, big adverse move so pnl < -collateral
            const [liq, hf] = await h.isLiquidatable(e18(1000), e18(100), 1, e18(10), e18(50), e18(100));
            expect(liq).to.equal(true);
            expect(hf).to.equal(0n);
        });
        it("healthy position has high health factor", async () => {
            const h = await loadFixture(deployHarness);
            const [liq, hf] = await h.isLiquidatable(e18(1000), e18(100), 1, e18(5), e18(100), e18(500));
            expect(liq).to.equal(false);
            expect(hf).to.be.greaterThan(PRECISION);
        });
    });

    describe("safeMul", () => {
        it("returns 0 when either operand is 0", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.safeMul(0, 5)).to.equal(0n);
            expect(await h.safeMul(5, 0)).to.equal(0n);
        });
        it("multiplies normally", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.safeMul(6, 7)).to.equal(42n);
        });
        it("reverts on overflow (checked arithmetic panic)", async () => {
            const h = await loadFixture(deployHarness);
            // a*b overflows the checked multiply before the post-check; Solidity 0.8 panics 0x11.
            await expect(h.safeMul(ethers.MaxUint256, 2)).to.be.reverted;
        });
    });

    describe("DataTypes helpers", () => {
        it("flag packing/unpacking", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.testPackFlags(true, false)).to.equal(1);
            expect(await h.testPackFlags(false, true)).to.equal(2);
            expect(await h.testPackFlags(true, true)).to.equal(3);
            expect(await h.testIsLong(1)).to.equal(true);
            expect(await h.testIsLong(2)).to.equal(false);
        });
        it("precision conversions round-trip", async () => {
            const h = await loadFixture(deployHarness);
            const usdcAmt = 1_000_000n; // 1 USDC
            const internal = await h.testToInternal(usdcAmt);
            expect(internal).to.equal(usdcAmt * 10n ** 12n);
            expect(await h.testToUsdc(internal)).to.equal(usdcAmt);
        });
    });
});
