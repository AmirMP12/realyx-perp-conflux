import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const U128_MAX = 2n ** 128n - 1n;

/**
 * Verifies the remaining PositionMath behaviors:
 *  - dynamic maintenance margin capped at MAX_DYNAMIC_MAINTENANCE_BPS
 *  - liquidation price clamped to the NO_LIQUIDATION sentinel
 *  - isLiquidatable early-out when the maintenance margin is zero
 *  - calculateFundingOwed large-size path with zero and non-zero remainders
 *  - slippage validation in both directions
 */
async function fcpm() {
    const libs = await deployAllLibraries();
    return deployHarness("FeeCalculatorPositionMathHarness", libs);
}

describe("PositionMath — dynamic maintenance & liquidation price", () => {
    it("calcDynamicMM caps total bps at MAX_DYNAMIC_MAINTENANCE_BPS for extreme leverage", async () => {
        const h = await loadFixture(fcpm);
        const size = e18(10_000);
        // leverageMultiplier = leverage / 1e18 = 200 -> additionalBps huge -> totalBps capped to 2000.
        // The initial-margin cap (50% of size/leverage) then dominates: size/leverage = size/200,
        // cap = (size/200) * 5000 / 10000 = size/400.
        const leverage = 200n * e18(1);
        const margin = await h.calcDynamicMM(size, leverage);
        expect(margin).to.equal(size / 400n);
    });

    it("calcDynamicMM with low leverage stays on the base-bps curve (no cap)", async () => {
        const h = await loadFixture(fcpm);
        const size = e18(10_000);
        const leverage = 2n * e18(1); // 2x -> multiplier 2 (<=5) -> baseBps 500 = 5%
        const margin = await h.calcDynamicMM(size, leverage);
        expect(margin).to.equal((size * 500n) / 10_000n);
    });

    it("calcLiqPrice clamps to the NO_LIQUIDATION sentinel when the computed price overflows uint128", async () => {
        const h = await loadFixture(fcpm);
        // Enormous entry price forces entry * factor / 1e18 to exceed uint128.max, hitting the clamp.
        const entry = 4n * 10n ** 38n;
        const leverage = 20n * e18(1);
        const liq = await h.calcLiqPrice(entry, leverage, e18(1), true);
        expect(liq).to.equal(U128_MAX);
    });

    it("calcLiqPrice reverts on zero entry price and zero leverage", async () => {
        const h = await loadFixture(fcpm);
        await expect(h.calcLiqPrice(0, e18(20), e18(1), true)).to.be.reverted;
        await expect(h.calcLiqPrice(e18(50_000), 0, e18(1), true)).to.be.reverted;
    });
});

describe("PositionMath — isLiquidatable edges", () => {
    it("returns (false, max) when maintenance margin is zero", async () => {
        const h = await loadFixture(fcpm);
        // size 0 -> dynamic maintenance margin 0 -> early-out.
        const [liq, hf] = await h.isLiquidatable(0, e18(50_000), 1, 20, e18(50_000), e18(1_000));
        expect(liq).to.equal(false);
        expect(hf).to.equal(ethers.MaxUint256);
    });

    it("returns (true, 0) when effective collateral is wiped out by losses", async () => {
        const h = await loadFixture(fcpm);
        // long with deep loss: pnl <= -collateral -> effectiveCollateral <= 0.
        const [liq, hf] = await h.isLiquidatable(e18(10_000), e18(50_000), 1, 20, e18(20_000), e18(1_000));
        expect(liq).to.equal(true);
        expect(hf).to.equal(0n);
    });

    it("returns (false, max) for a non-open position via isLiquidatableClosed", async () => {
        const h = await loadFixture(fcpm);
        const [liq, hf] = await h.isLiquidatableClosed(e18(10_000), e18(50_000), 1, e18(40_000), e18(1_000));
        expect(liq).to.equal(false);
        expect(hf).to.equal(ethers.MaxUint256);
    });
});

describe("PositionMath — funding owed large-size path", () => {
    it("computes funding for a large long with a non-zero remainder", async () => {
        const h = await loadFixture(fcpm);
        const size = 10n ** 29n + 1n; // > uint96.max and not divisible by 1e18 -> remainder 1
        const delta = 10n ** 14n;
        const owed = await h.calcFundingOwed(size, 1, delta); // long
        expect(owed).to.be.greaterThan(0n);
    });

    it("computes funding for a large long with a zero remainder", async () => {
        const h = await loadFixture(fcpm);
        const size = 10n ** 29n; // > uint96.max and divisible by 1e18 -> remainder 0
        const delta = 10n ** 14n;
        const owed = await h.calcFundingOwed(size, 1, delta);
        expect(owed).to.be.greaterThan(0n);
    });

    it("negates funding for a large short position", async () => {
        const h = await loadFixture(fcpm);
        const size = 10n ** 29n + 1n;
        const delta = 10n ** 14n;
        const owed = await h.calcFundingOwed(size, 0, delta); // short -> negative
        expect(owed).to.be.lessThan(0n);
    });

    it("returns 0 when funding delta is zero", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcFundingOwed(10n ** 29n, 1, 0)).to.equal(0n);
    });
});

describe("PositionMath — slippage validation", () => {
    it("validates long slippage in both directions around the cap", async () => {
        const h = await loadFixture(fcpm);
        // long valid when actual <= expected + maxDeviation (1% of 50000 = 500)
        expect(await h.validateSlippage(e18(50_000), e18(50_500), 100, true)).to.equal(true);
        expect(await h.validateSlippage(e18(50_000), e18(50_501), 100, true)).to.equal(false);
    });

    it("validates short slippage in both directions around the cap", async () => {
        const h = await loadFixture(fcpm);
        // short valid when actual >= expected - maxDeviation
        expect(await h.validateSlippage(e18(50_000), e18(49_500), 100, false)).to.equal(true);
        expect(await h.validateSlippage(e18(50_000), e18(49_499), 100, false)).to.equal(false);
    });

    it("returns false when expected price is zero", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.validateSlippage(0, e18(50_000), 100, true)).to.equal(false);
    });
});
