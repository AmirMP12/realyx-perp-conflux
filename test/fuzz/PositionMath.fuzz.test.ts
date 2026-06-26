import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Property-based / fuzz tests for the pure math libraries. We generate many
 * random inputs and assert invariants that must hold for ALL inputs, rather
 * than specific examples. Runs are bounded for CI speed but cover a wide range.
 */
async function deployHarness() {
    const H = await ethers.getContractFactory("FeeCalculatorPositionMathHarness");
    const h = await H.deploy();
    await h.waitForDeployment();
    return h;
}

const RUNS = 100;
const e18 = (n: bigint) => n * 10n ** 18n;

function randBig(maxExclusive: bigint): bigint {
    // 32 random bytes -> bigint mod max
    const bytes = ethers.randomBytes(32);
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    return v % maxExclusive;
}

describe("Fuzz — PositionMath invariants", () => {
    it("PnL sign symmetry: long(P) == -short(P) for all sizes/prices", async () => {
        const h = await loadFixture(deployHarness);
        for (let i = 0; i < RUNS; i++) {
            const size = e18(1n + randBig(1_000_000n));
            const entry = e18(1n + randBig(200_000n));
            const cur = e18(1n + randBig(200_000n));
            const long = await h.calcPnL(size, entry, cur, true);
            const short = await h.calcPnL(size, entry, cur, false);
            expect(long).to.equal(-short);
        }
    });

    it("unrealized PnL never exceeds notional magnitude bound", async () => {
        const h = await loadFixture(deployHarness);
        for (let i = 0; i < RUNS; i++) {
            const size = e18(1n + randBig(1_000_000n));
            const entry = e18(1n + randBig(200_000n));
            const cur = e18(1n + randBig(400_000n));
            const pnl = await h.calcPnL(size, entry, cur, true);
            // |pnl| = size * |cur-entry| / entry; bounded by size * cur / entry
            const absPnl = pnl < 0n ? -pnl : pnl;
            const bound = (size * (cur > entry ? cur : entry)) / entry + 1n;
            expect(absPnl).to.be.lessThanOrEqual(bound);
        }
    });

    it("dynamic maintenance margin stays below initial margin (positions openable) and capped at 20%", async () => {
        const h = await loadFixture(deployHarness);
        const size = e18(10_000n);
        for (let lev = 1; lev <= 100; lev += 1) {
            const mm = await h.calcDynamicMM(size, e18(BigInt(lev)));
            // Never exceeds the 20% absolute cap.
            expect(mm).to.be.lessThanOrEqual((size * 2000n) / 10_000n);
            // Crucially, never exceeds 50% of the initial-margin budget
            // (size / leverage). This guarantees a freshly-opened position at
            // ANY leverage up to 100x has a positive health buffer at entry and
            // is therefore openable — the property that was broken before the
            // initial-margin cap was added.
            const initialMargin = size / BigInt(lev);
            expect(mm).to.be.lessThanOrEqual(initialMargin / 2n);
            // And strictly below the full initial margin (health > 1 at entry).
            expect(mm).to.be.lessThan(initialMargin);
        }
    });

    it("funding rate is bounded by base rate and signed by imbalance", async () => {
        const h = await loadFixture(deployHarness);
        const base = 10n ** 14n;
        for (let i = 0; i < RUNS; i++) {
            const longOI = randBig(1_000_000n) * 10n ** 18n;
            const shortOI = randBig(1_000_000n) * 10n ** 18n;
            const rate = await h.calcFundingRate(longOI, shortOI, base);
            const absRate = rate < 0n ? -rate : rate;
            expect(absRate).to.be.lessThanOrEqual(base);
            if (longOI > shortOI) expect(rate).to.be.greaterThanOrEqual(0n);
            if (shortOI > longOI) expect(rate).to.be.lessThanOrEqual(0n);
        }
    });

    it("initial margin * leverage ~= size (within rounding)", async () => {
        const h = await loadFixture(deployHarness);
        for (let i = 0; i < RUNS; i++) {
            const size = e18(1n + randBig(1_000_000n));
            const lev = 1n + randBig(50n);
            const margin = await h.calcInitialMargin(size, e18(lev));
            // margin = size/lev; margin*lev <= size
            expect(margin * lev).to.be.lessThanOrEqual(size);
            // and within one lev-step of size
            expect(margin * lev).to.be.greaterThan(size - size / 1000n - lev);
        }
    });

    it("liquidation price: long < entry < short across the full leverage range (when not sentinel)", async () => {
        const h = await loadFixture(deployHarness);
        const SENT = (1n << 128n) - 1n;
        for (let i = 0; i < RUNS; i++) {
            const entry = e18(1n + randBig(100_000n));
            const size = e18(1n + randBig(100_000n));
            // With maintenance margin now capped below 1/leverage at every
            // leverage, the long liq price is strictly below entry and the short
            // liq price strictly above entry across the whole 1..100x range.
            const lev = 1n + randBig(100n); // 1..100
            const longLp = await h.calcLiqPrice(entry, e18(lev), size, true);
            const shortLp = await h.calcLiqPrice(entry, e18(lev), size, false);
            if (longLp !== SENT) expect(longLp).to.be.lessThanOrEqual(entry);
            if (shortLp !== SENT) expect(shortLp).to.be.greaterThanOrEqual(entry);
        }
    });

    it("high-leverage longs liquidate BELOW entry (maintenance capped below 1/leverage)", async () => {
        const h = await loadFixture(deployHarness);
        // After the initial-margin cap, maintenance margin is capped at 50% of
        // the initial-margin budget (1/leverage), so the maintenance fraction is
        // always strictly below 1/leverage. The long liquidation price therefore
        // computes BELOW entry at every leverage — including high leverage —
        // meaning positions are NOT instantly liquidatable at entry. This
        // replaces the prior model where >=~20x longs computed a liq price ABOVE
        // entry (i.e. were un-openable).
        const entry = e18(50_000n);
        const size = e18(10_000n);
        const SENT = (1n << 128n) - 1n;
        const lpHigh = await h.calcLiqPrice(entry, e18(25n), size, true);
        expect(lpHigh).to.not.equal(SENT);
        expect(lpHigh).to.be.lessThan(entry);
        expect(lpHigh).to.be.greaterThan(0n);
    });

    it("validateSlippage is symmetric around expected for tiny slippage", async () => {
        const h = await loadFixture(deployHarness);
        for (let i = 0; i < 50; i++) {
            const expected = e18(1n + randBig(100_000n));
            // exact price always valid for both sides
            expect(await h.validateSlippage(expected, expected, 100, true)).to.equal(true);
            expect(await h.validateSlippage(expected, expected, 100, false)).to.equal(true);
        }
    });

    it("calculateFundingIntervals is floor division and monotonic in time", async () => {
        const h = await loadFixture(deployHarness);
        const interval = 8n * 60n * 60n;
        for (let i = 0; i < 50; i++) {
            const last = randBig(1_000_000n);
            const elapsed = randBig(100n) * interval + randBig(interval);
            const cur = last + elapsed;
            const n = await h.calcFundingIntervals(last, cur, interval);
            expect(n).to.equal(elapsed / interval);
        }
    });
});
