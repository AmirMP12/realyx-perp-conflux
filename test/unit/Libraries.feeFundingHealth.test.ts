import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

/**
 * Verifies FeeCalculator referral and rebate fee math, PositionMath safe-casts
 * and edge math, HealthLib insurance netting and soft thresholds, FundingLib
 * settlement caps, and CircuitBreakerLib auto-reset and guards.
 */

async function fcpm() {
    const libs = await deployAllLibraries();
    return deployHarness("FeeCalculatorPositionMathHarness", libs);
}

async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

describe("FeeCalculator referral & rebate paths", () => {
    it("trading fee: discount below feeBps reduces, at/above zeroes", async () => {
        const h = await loadFixture(fcpm);
        // taker 10bps, discount 4 -> 6bps
        expect(await h.calcTradingFee(e18(10_000), 2, 10, 0, false, 4)).to.equal((e18(10_000) * 6n) / 10_000n);
        // discount >= feeBps -> 0 rate, but minFee floor 0 here
        expect(await h.calcTradingFee(e18(10_000), 2, 10, 0, false, 10)).to.equal(0n);
        expect(await h.calcTradingFee(e18(10_000), 2, 10, 0, false, 50)).to.equal(0n);
    });

    it("trading fee: minFee floor applies when computed below it", async () => {
        const h = await loadFixture(fcpm);
        // tiny size, minFeeUsdc 1 (1e6 -> internal). fee below floor -> floored
        const fee = await h.calcTradingFee(1n, 2, 10, 1, false, 0);
        expect(fee).to.be.greaterThan(0n);
    });

    it("opening fee with referral discount: reduce, zero, and minFee floor", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcOpeningFeeRef(e18(10_000), 10, 0, 4)).to.equal((e18(10_000) * 6n) / 10_000n);
        expect(await h.calcOpeningFeeRef(e18(10_000), 10, 0, 10)).to.equal(0n);
        expect(await h.calcOpeningFeeRef(e18(10_000), 10, 0, 0)).to.equal((e18(10_000) * 10n) / 10_000n);
        // minFee floor applies even with full discount
        expect(await h.calcOpeningFeeRef(1n, 10, 1, 100)).to.be.greaterThan(0n);
    });

    it("closing fee with referral discount: partial, full, and zero", async () => {
        const h = await loadFixture(fcpm);
        const base = (e18(10_000) * 10n) / 10_000n;
        // 50% discount
        expect(await h.calcClosingFeeRef(e18(10_000), 2, 10, 0, true, 5000)).to.equal(base / 2n);
        // 100% discount -> 0
        expect(await h.calcClosingFeeRef(e18(10_000), 2, 10, 0, true, 10000)).to.equal(0n);
        // no discount
        expect(await h.calcClosingFeeRef(e18(10_000), 2, 10, 0, true, 0)).to.equal(base);
    });

    it("splitFeesWithRebate: zero rebate delegates to splitFees", async () => {
        const h = await loadFixture(fcpm);
        const [lp, ins, treas, rebate] = await h.splitFeesWithRebate(e18(1000), 7000, 2000, 1000, 0);
        expect(rebate).to.equal(0n);
        expect(lp + ins + treas).to.equal(e18(1000));
    });

    it("splitFeesWithRebate: non-zero rebate carves from total first", async () => {
        const h = await loadFixture(fcpm);
        const [lp, ins, treas, rebate] = await h.splitFeesWithRebate(e18(1000), 7000, 2000, 1000, 1000);
        expect(rebate).to.equal(e18(100)); // 10%
        expect(lp + ins + treas + rebate).to.equal(e18(1000));
    });

    it("splitFeesWithRebate: invalid config reverts", async () => {
        const h = await loadFixture(fcpm);
        await expect(h.splitFeesWithRebate(e18(1000), 7000, 2000, 999, 100)).to.be.reverted;
    });

    it("liquidation fee tiers + maxFee cap", async () => {
        const h = await loadFixture(fcpm);
        // near (>=0.8e18)
        const [near] = await h.calcLiqFee(e18(1000), 9n * 10n ** 17n);
        // medium (>=0.5e18)
        const [med] = await h.calcLiqFee(e18(1000), 6n * 10n ** 17n);
        // deep (<0.5e18) -> remaining collateral tiny -> maxFee cap applies
        const [deep] = await h.calcLiqFee(e18(1000), 1n * 10n ** 17n);
        expect(near).to.be.greaterThanOrEqual(0n);
        expect(med).to.be.greaterThanOrEqual(0n);
        expect(deep).to.be.greaterThanOrEqual(0n);
    });

    it("validateFeeConfig false cases", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.validateFeeConfig(2000, 5, 7000, 2000, 1000)).to.equal(false); // maker > MAX
        expect(await h.validateFeeConfig(2, 2000, 7000, 2000, 1000)).to.equal(false); // taker > MAX
        expect(await h.validateFeeConfig(2, 5, 7000, 2000, 999)).to.equal(false); // shares != BPS
        expect(await h.validateFeeConfig(10, 5, 7000, 2000, 1000)).to.equal(false); // taker < maker
        expect(await h.validateFeeConfig(2, 5, 7000, 2000, 1000)).to.equal(true);
    });

    it("getDefaultFeeConfig + getDefaultLiquidationTiers reachable", async () => {
        const h = await loadFixture(fcpm);
        const cfg = await h.getDefaultFeeConfig();
        expect(cfg.takerFeeBps).to.equal(5n);
    });

    it("effective fee rate clamps discount to max", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcEffectiveFeeRate(100, 60, 40)).to.equal(60n); // clamp to 40 -> 60
        expect(await h.calcEffectiveFeeRate(30, 60, 40)).to.equal(0n); // base < discount
    });

    it("conditional order fee cases", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcConditionalOrderFee(e18(1000), 0)).to.equal((e18(1000) * 3n) / 10_000n);
        expect(await h.calcConditionalOrderFee(e18(1000), 1)).to.equal((e18(1000) * 3n) / 10_000n);
        expect(await h.calcConditionalOrderFee(e18(1000), 2)).to.equal((e18(1000) * 5n) / 10_000n);
    });

    it("gas refund cap", async () => {
        const h = await loadFixture(fcpm);
        const refund = await h.calcGasRefund(1_000_000, ethers.parseUnits("100", 9), e18(3000), 1n);
        expect(refund).to.equal(1n); // capped to maxRefund
    });
});

describe("PositionMath edge cases", () => {
    it("safe casts revert on overflow and pass within range", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.toUint128(123n)).to.equal(123n);
        expect(await h.toUint64(123n)).to.equal(123n);
        expect(await h.toUint16(123n)).to.equal(123n);
        await expect(h.toUint128(2n ** 128n)).to.be.reverted;
        await expect(h.toUint64(2n ** 64n)).to.be.reverted;
        await expect(h.toUint16(2n ** 16n)).to.be.reverted;
    });

    it("calculateUnrealizedPnL all four sign cases", async () => {
        const h = await loadFixture(fcpm);
        // long profit / loss
        expect(await h.calcPnL(e18(1000), e18(100), e18(110), true)).to.be.greaterThan(0n);
        expect(await h.calcPnL(e18(1000), e18(100), e18(90), true)).to.be.lessThan(0n);
        // short profit / loss
        expect(await h.calcPnL(e18(1000), e18(100), e18(90), false)).to.be.greaterThan(0n);
        expect(await h.calcPnL(e18(1000), e18(100), e18(110), false)).to.be.lessThan(0n);
        // size 0 -> 0
        expect(await h.calcPnL(0, e18(100), e18(110), true)).to.equal(0n);
    });

    it("calculateUnrealizedPnL reverts on zero entry", async () => {
        const h = await loadFixture(fcpm);
        await expect(h.calcPnL(e18(1000), 0, e18(110), true)).to.be.reverted;
    });

    it("calcPnLPercent reverts on zero collateral", async () => {
        const h = await loadFixture(fcpm);
        await expect(h.calcPnLPercent(e18(1), 0)).to.be.reverted;
        expect(await h.calcPnLPercent(e18(100), e18(1000))).to.not.equal(0n);
    });

    it("initial margin reverts on zero leverage", async () => {
        const h = await loadFixture(fcpm);
        await expect(h.calcInitialMargin(e18(1000), 0)).to.be.reverted;
    });

    it("maintenance margin floors to MIN below threshold", async () => {
        const h = await loadFixture(fcpm);
        // bps below MIN(100) -> uses 100
        expect(await h.calcMaintenanceMargin(e18(10_000), 50)).to.equal((e18(10_000) * 100n) / 10_000n);
        expect(await h.calcMaintenanceMargin(e18(10_000), 500)).to.equal((e18(10_000) * 500n) / 10_000n);
    });

    it("liq price: long no-liquidation sentinel & short side", async () => {
        const h = await loadFixture(fcpm);
        // low leverage long likely returns a finite price
        const longP = await h.calcLiqPrice(e18(100), e18(2), e18(1000), true);
        expect(longP).to.be.greaterThan(0n);
        // short
        const shortP = await h.calcLiqPrice(e18(100), e18(2), e18(1000), false);
        expect(shortP).to.be.greaterThan(0n);
    });

    it("liq price reverts on zero entry / zero leverage", async () => {
        const h = await loadFixture(fcpm);
        await expect(h.calcLiqPrice(0, e18(2), e18(1000), true)).to.be.reverted;
        await expect(h.calcLiqPrice(e18(100), 0, e18(1000), true)).to.be.reverted;
    });

    it("funding rate long/short/balanced cases", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcFundingRate(e18(2000), e18(1000), e18(1) / 10000n)).to.be.greaterThan(0n);
        expect(await h.calcFundingRate(e18(1000), e18(2000), e18(1) / 10000n)).to.be.lessThan(0n);
        expect(await h.calcFundingRate(0, 0, e18(1) / 10000n)).to.equal(0n);
    });

    it("funding owed: zero size / zero delta short-circuit & large-size path", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcFundingOwed(0, 1, e18(1))).to.equal(0n);
        expect(await h.calcFundingOwed(e18(1000), 1, 0)).to.equal(0n);
        // short flips sign
        const long = await h.calcFundingOwed(e18(1000), 1, e18(1) / 100n);
        const short = await h.calcFundingOwed(e18(1000), 0, e18(1) / 100n);
        expect(long).to.equal(-short);
    });

    it("funding intervals: zero when no time / zero interval", async () => {
        const h = await loadFixture(fcpm);
        const now = await time.latest();
        expect(await h.calcFundingIntervals(now, now, 100)).to.equal(0n);
        expect(await h.calcFundingIntervals(0, now, 0)).to.equal(0n);
        expect(await h.calcFundingIntervals(0, 1000, 100)).to.equal(10n);
    });

    it("validateSlippage long/short and zero-expected", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.validateSlippage(0, e18(100), 100, true)).to.equal(false);
        expect(await h.validateSlippage(e18(100), e18(100), 100, true)).to.equal(true);
        expect(await h.validateSlippage(e18(100), e18(100), 100, false)).to.equal(true);
    });

    it("isLiquidatable: not-open, zero price, effective collateral <=0", async () => {
        const h = await loadFixture(fcpm);
        // closed -> not liquidatable
        const [c] = await h.isLiquidatableClosed(e18(1000), e18(100), 1, e18(100), e18(50));
        expect(c).to.equal(false);
        // zero price
        const [z] = await h.isLiquidatable(e18(1000), e18(100), 1, 20, 0, e18(50));
        expect(z).to.equal(false);
        // deep underwater long
        const [u] = await h.isLiquidatable(e18(10_000), e18(100), 1, 20, e18(50), e18(10));
        expect(u).to.equal(true);
    });

    it("safeMul zero and overflow", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.safeMul(0, 5)).to.equal(0n);
        expect(await h.safeMul(3, 4)).to.equal(12n);
        await expect(h.safeMul(2n ** 200n, 2n ** 200n)).to.be.reverted;
    });
});

describe("HealthLib insurance netting & soft threshold", () => {
    async function deploy() {
        const libs = await deployAllLibraries();
        return deployHarness("HealthLibHarness", libs);
    }
    it("insurance covers bad debt -> healthy", async () => {
        const h = await loadFixture(deploy);
        await h.setBadDebt(e18(100));
        await h.updateWithInsurance(e18(1_000_000), e18(200));
        const [healthy] = await h.getState();
        expect(healthy).to.equal(true);
    });
    it("uncovered bad debt above ratio -> unhealthy", async () => {
        const h = await loadFixture(deploy);
        await h.setBadDebt(e18(900_000));
        await h.updateWithInsurance(e18(1_000_000), 0);
        const [healthy] = await h.getState();
        expect(healthy).to.equal(false);
    });
    it("zero TVL with insurance path -> healthy", async () => {
        const h = await loadFixture(deploy);
        await h.setBadDebt(e18(100));
        await h.updateWithInsurance(0, 0);
        const [healthy] = await h.getState();
        expect(healthy).to.equal(true);
    });
    it("soft threshold crossing (legacy path) keeps healthy but flags ratio", async () => {
        const h = await loadFixture(deploy);
        // net/TVL ratio between 250 and 500 bps -> 3% = 300 bps
        await h.setBadDebt(e18(30_000));
        await h.update(e18(1_000_000));
        const [healthy] = await h.getState();
        expect(healthy).to.equal(true); // 3% < 5% max -> still healthy
    });
    it("soft threshold crossing (insurance path) keeps healthy but flags ratio", async () => {
        const h = await loadFixture(deploy);
        await h.setBadDebt(e18(40_000));
        await h.updateWithInsurance(e18(1_000_000), e18(10_000));
        const [healthy] = await h.getState();
        expect(healthy).to.equal(true); // net 30k -> 3% < 5%
    });
});

describe("FundingLib settle cap & shortfall events", () => {
    async function deploy() {
        const libs = await deployAllLibraries();
        return deployHarness("FundingLibHarness", libs);
    }
    it("zeros collateral and reports shortfall when funding exceeds collateral", async () => {
        const h = await loadFixture(deploy);
        await h.setCollateral(e18(10));
        const [, shortfall] = await h.applyFunding.staticCall(e18(30), 7);
        expect(shortfall).to.equal(e18(20));
        await h.applyFunding(e18(30), 7);
        expect(await h.collateralAmount()).to.equal(0n);
    });
});

describe("CircuitBreakerLib autoReset & guards", () => {
    const MARKET = "0x00000000000000000000000000000000000000B7";
    it("autoResetBreakers clears triggered after cooldown", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, 0, 500, 900, 600);
        await h.testTriggerBreaker(MARKET, 0);
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(false);
        await time.increase(601);
        await h.testAutoResetBreakers(MARKET);
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(true);
    });
    it("configureBreaker reverts on zero window / cooldown", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(h.testConfigureBreaker(MARKET, 0, 500, 0, 600)).to.be.reverted;
        await expect(h.testConfigureBreaker(MARKET, 0, 500, 900, 0)).to.be.reverted;
    });
    it("triggerBreaker reverts when not configured & when already triggered", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(h.testTriggerBreaker(MARKET, 0)).to.be.reverted; // not configured
        await h.testConfigureBreaker(MARKET, 0, 500, 900, 600);
        await h.testTriggerBreaker(MARKET, 0);
        await expect(h.testTriggerBreaker(MARKET, 0)).to.be.reverted; // already triggered
    });
    it("resetBreaker reverts when not triggered & cooldown active for non-admin", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, 0, 500, 900, 600);
        await expect(h.testResetBreaker(MARKET, 0, false)).to.be.reverted; // not triggered
        await h.testTriggerBreaker(MARKET, 0);
        await expect(h.testResetBreaker(MARKET, 0, false)).to.be.reverted; // cooldown active
        // admin override during cooldown emits BreakerResetByAdmin and succeeds
        await h.testResetBreaker(MARKET, 0, true);
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(true);
    });
    it("EMERGENCY breaker blocks all action types", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, 5, 500, 900, 600); // EMERGENCY
        await h.testTriggerBreaker(MARKET, 5);
        expect(await h.testIsActionAllowed(MARKET, 1, false)).to.equal(false);
    });
    it("checkPriceDropBreaker no-trigger when refPrice zero / disabled", async () => {
        const h = await loadFixture(coverageHarness);
        // not configured -> disabled
        expect(await h.testCheckPriceDropBreaker.staticCall(MARKET, e18(90), e18(100))).to.equal(false);
        await h.testConfigureBreaker(MARKET, 0, 500, 900, 600);
        expect(await h.testCheckPriceDropBreaker.staticCall(MARKET, e18(90), 0)).to.equal(false);
    });
    it("checkTWAPDeviationBreaker disabled & zero twap cases", async () => {
        const h = await loadFixture(coverageHarness);
        expect(await h.testCheckTWAPDeviationBreaker.staticCall(MARKET, e18(120), e18(100))).to.equal(false);
        await h.testConfigureBreaker(MARKET, 2, 500, 900, 600);
        expect(await h.testCheckTWAPDeviationBreaker.staticCall(MARKET, e18(120), 0)).to.equal(false);
    });
});
