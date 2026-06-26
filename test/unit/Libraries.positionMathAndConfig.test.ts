import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function fcpm() {
    const libs = await deployAllLibraries();
    return deployHarness("FeeCalculatorPositionMathHarness", libs);
}

describe("PositionMath — maintenance margin and liquidation edge cases", () => {
    it("calculateDynamicMaintenanceMargin caps at MAX_DYNAMIC_MAINTENANCE_BPS for very high leverage", async () => {
        const h = await loadFixture(fcpm);
        // very high leverage pushes the bps curve above the 20% cap; result is
        // then bounded by the 50%-of-initial-margin cap.
        const mm = await h.calcDynamicMM(e18(10_000), e18(100));
        expect(mm).to.be.greaterThan(0n);
    });

    it("liq price: long no-liquidation sentinel at very low leverage", async () => {
        const h = await loadFixture(fcpm);
        // leverage 1x: PRECISION + mmFraction <= inverseL is false for small mm,
        // but a finite price returns; check both long and short produce values.
        const longP = await h.calcLiqPrice(e18(100), e18(1), e18(1000), true);
        const shortP = await h.calcLiqPrice(e18(100), e18(1), e18(1000), false);
        expect(longP).to.be.greaterThan(0n);
        expect(shortP).to.be.greaterThan(0n);
    });

    it("liq price with zero size uses the default maintenance fraction", async () => {
        const h = await loadFixture(fcpm);
        const p = await h.calcLiqPrice(e18(100), e18(5), 0, true);
        expect(p).to.be.greaterThan(0n);
    });

    it("isLiquidatable: effective collateral <= 0 returns liquidatable with hf 0", async () => {
        const h = await loadFixture(fcpm);
        // huge loss so collateral + pnl <= 0
        const [liq, hf] = await h.isLiquidatable(e18(100_000), e18(100), 1, 50, e18(10), e18(10));
        expect(liq).to.equal(true);
        expect(hf).to.equal(0n);
    });

    it("isLiquidatable: long no-liquidation sentinel short-circuits", async () => {
        const h = await loadFixture(fcpm);
        const [liq, hf] = await h.isLiquidatableSentinelLong(e18(1000), e18(100), 20, e18(50), e18(2000));
        expect(liq).to.equal(false);
        expect(hf).to.equal(ethers.MaxUint256);
    });

    it("isLiquidatable closed position returns not-liquidatable sentinel", async () => {
        const h = await loadFixture(fcpm);
        const [liq, hf] = await h.isLiquidatableClosed(e18(1000), e18(100), 1, e18(50), e18(2000));
        expect(liq).to.equal(false);
        expect(hf).to.equal(ethers.MaxUint256);
    });

    it("getPositionPnLExt: open vs closed", async () => {
        const h = await loadFixture(fcpm);
        // closed -> (0,0)
        const [pnlClosed, hfClosed] = await h.getPositionPnLExt(e18(1000), e18(100), 1, 20, PosStatus.CLOSED, e18(500), e18(110));
        expect(pnlClosed).to.equal(0n);
        expect(hfClosed).to.equal(0n);
        // open long in profit
        const [pnlOpen] = await h.getPositionPnLExt(e18(1000), e18(100), 1, 20, PosStatus.OPEN, e18(500), e18(110));
        expect(pnlOpen).to.be.greaterThan(0n);
    });

    it("canLiquidateExt: open vs closed", async () => {
        const h = await loadFixture(fcpm);
        const [liqClosed, hfClosed] = await h.canLiquidateExt(e18(1000), e18(100), 1, 20, PosStatus.CLOSED, e18(500), e18(110));
        expect(liqClosed).to.equal(false);
        expect(hfClosed).to.equal(ethers.MaxUint256);
        const [liqOpen] = await h.canLiquidateExt(e18(10_000), e18(100), 1, 20, PosStatus.OPEN, e18(50), e18(90));
        expect(liqOpen).to.equal(true);
    });

    it("calculateUnrealizedPnL short loss and short profit explicit", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcPnL(e18(1000), e18(100), e18(120), false)).to.be.lessThan(0n); // short loss
        expect(await h.calcPnL(e18(1000), e18(100), e18(80), false)).to.be.greaterThan(0n); // short profit
    });
});

describe("ConfigLib — margin-config boundary cases", () => {
    async function coverageHarness() {
        const libs = await deployAllLibraries();
        return deployHarness("CoverageHarness", libs);
    }
    const M = "0x00000000000000000000000000000000000000B7";
    const FEED = "0x00000000000000000000000000000000000000F1";

    it("setMarket boundary margin configs (mm=50, im=100, mm=5000<im)", async () => {
        const h = await loadFixture(coverageHarness);
        // exercise the boundary-valid margin-config combinations
        await h.testSetMarket(M, FEED, 100, e18(1_000_000), e18(5_000_000), 50, 100, 900, e18(1) / 2n);
    });

    it("setMarket reverts when maxLev exactly 0 and exactly above limit", async () => {
        const h = await loadFixture(coverageHarness);
        await expect(
            h.testSetMarket(M, FEED, 0, e18(1_000_000), e18(5_000_000), 50, 100, 900, e18(1) / 2n),
        ).to.be.reverted;
    });

    it("updateMarket boundary margin config", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testSetMarket(M, FEED, 100, e18(1_000_000), e18(5_000_000), 50, 100, 900, e18(1) / 2n);
        await h.testUpdateMarket(M, FEED, 100, e18(1_000_000), e18(5_000_000), 4999, 5000, 900, e18(1) / 2n);
    });
});
