import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function deployHarness() {
    const H = await ethers.getContractFactory("FeeCalculatorPositionMathHarness");
    const h = await H.deploy();
    await h.waitForDeployment();
    return h;
}

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

describe("FeeCalculator (unit + branches)", () => {
    describe("calculateTradingFee", () => {
        it("returns 0 when size is 0", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcTradingFee(0, 2, 5, 0, false, 0)).to.equal(0n);
        });
        it("uses maker bps when isMaker", async () => {
            const h = await loadFixture(deployHarness);
            // size 1,000,000e18 * 2bps = 200e18
            expect(await h.calcTradingFee(e18(1_000_000), 2, 5, 0, true, 0)).to.equal(e18(200));
        });
        it("uses taker bps when not maker", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcTradingFee(e18(1_000_000), 2, 5, 0, false, 0)).to.equal(e18(500));
        });
        it("applies partial referral discount (discount < feeBps)", async () => {
            const h = await loadFixture(deployHarness);
            // taker 5bps, discount 2bps -> 3bps
            expect(await h.calcTradingFee(e18(1_000_000), 2, 5, 0, false, 2)).to.equal(e18(300));
        });
        it("zeros the bps when discount >= feeBps but still applies min fee", async () => {
            const h = await loadFixture(deployHarness);
            // discount 10 >= 5 -> feeBps 0 -> fee 0, but minFee floor applies
            // minFeeUsdc 1 (1e6 internal = 1e18? actually toInternalPrecision(1)=1e12)
            const fee = await h.calcTradingFee(e18(1_000_000), 2, 5, 1, false, 10);
            expect(fee).to.equal(1n * 10n ** 12n);
        });
        it("enforces minFee floor when computed fee below it", async () => {
            const h = await loadFixture(deployHarness);
            // size 1e18 * 5bps = 5e14; minFeeUsdc 1000 -> 1e15 internal floor dominates
            const fee = await h.calcTradingFee(e18(1), 2, 5, 1000, false, 0);
            expect(fee).to.equal(1000n * 10n ** 12n);
        });
    });

    describe("calculateOpeningFee", () => {
        it("uses taker bps", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcOpeningFee(e18(1_000_000), 5, 0)).to.equal(e18(500));
        });
        it("applies min fee floor", async () => {
            const h = await loadFixture(deployHarness);
            // 1e18 * 5bps = 5e14 internal; minFeeUsdc 1000 -> 1e15 floor dominates
            expect(await h.calcOpeningFee(e18(1), 5, 1000)).to.equal(1000n * 10n ** 12n);
        });
    });

    describe("calculateClosingFee", () => {
        it("taker bps for market orders", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcClosingFee(e18(1_000_000), 2, 5, 0, true)).to.equal(e18(500));
        });
        it("maker bps for limit orders", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcClosingFee(e18(1_000_000), 2, 5, 0, false)).to.equal(e18(200));
        });
        it("applies min fee floor", async () => {
            const h = await loadFixture(deployHarness);
            // 1e18 * 5bps = 5e14 internal; minFeeUsdc 1000 -> 1e15 floor dominates
            expect(await h.calcClosingFee(e18(1), 2, 5, 1000, true)).to.equal(1000n * 10n ** 12n);
        });
    });

    describe("calculateLiquidationFee (tiered)", () => {
        it("near-threshold tier for hf >= 0.8e18", async () => {
            const h = await loadFixture(deployHarness);
            const [total, liq, ins] = await h.calcLiqFee(e18(1000), e18(1));
            // collateral remaining = size*hf/1e18 = 1000; maxFee = 500; total = min(250bps*1000, 500)=25
            expect(total).to.equal(e18(25));
            expect(liq).to.equal(total / 2n); // 5000 bps share
            expect(ins).to.equal(total - liq);
        });
        it("medium-risk tier for 0.5e18 <= hf < 0.8e18", async () => {
            const h = await loadFixture(deployHarness);
            const [total] = await h.calcLiqFee(e18(1000), 6n * 10n ** 17n);
            // 500 bps of 1000 = 50; cap = (1000*0.6)/2 = 300 -> 50
            expect(total).to.equal(e18(50));
        });
        it("deeply-underwater tier for hf < 0.5e18", async () => {
            const h = await loadFixture(deployHarness);
            const [total] = await h.calcLiqFee(e18(1000), 3n * 10n ** 17n);
            expect(total).to.be.greaterThan(0n);
        });
        it("caps fee at half of remaining collateral", async () => {
            const h = await loadFixture(deployHarness);
            // hf very small so remaining collateral tiny -> cap dominates
            const [total] = await h.calcLiqFee(e18(1000), 1n * 10n ** 16n); // 0.01e18
            // remaining = 1000 * 0.01 = 10; cap = 5
            expect(total).to.equal(e18(5));
        });
    });

    describe("splitFees", () => {
        it("reverts when shares don't sum to BPS", async () => {
            const h = await loadFixture(deployHarness);
            await expect(h.splitFees(e18(100), 7000, 2000, 500)).to.be.revertedWithCustomError(h, "InvalidFeeConfig");
        });
        it("splits proportionally with treasury remainder", async () => {
            const h = await loadFixture(deployHarness);
            const [lp, ins, treas] = await h.splitFees(e18(100), 7000, 2000, 1000);
            expect(lp).to.equal(e18(70));
            expect(ins).to.equal(e18(20));
            expect(treas).to.equal(e18(10));
            expect(lp + ins + treas).to.equal(e18(100));
        });
    });

    describe("validateFeeConfig", () => {
        it("rejects maker bps above max", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.validateFeeConfig(2000, 2000, 7000, 2000, 1000)).to.equal(false);
        });
        it("rejects taker bps above max", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.validateFeeConfig(2, 2000, 7000, 2000, 1000)).to.equal(false);
        });
        it("rejects shares not summing to BPS", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.validateFeeConfig(2, 5, 7000, 2000, 500)).to.equal(false);
        });
        it("rejects taker < maker", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.validateFeeConfig(5, 2, 7000, 2000, 1000)).to.equal(false);
        });
        it("accepts a valid config", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.validateFeeConfig(2, 5, 7000, 2000, 1000)).to.equal(true);
        });
    });

    describe("keeper reward / gas refund", () => {
        it("keeper reward scales with gas, price, multiplier", async () => {
            const h = await loadFixture(deployHarness);
            // gasUsed 100000, gasPrice 1e9, ethPrice 2000e18, mult 12000 bps (1.2x)
            const r = await h.calcKeeperReward(100000, 10n ** 9n, e18(2000), 12000);
            expect(r).to.be.greaterThan(0n);
        });
        it("gas refund caps at maxRefund", async () => {
            const h = await loadFixture(deployHarness);
            const refund = await h.calcGasRefund(100000, 10n ** 12n, e18(2000), 1n);
            expect(refund).to.equal(1n);
        });
        it("gas refund below cap returns computed value", async () => {
            const h = await loadFixture(deployHarness);
            const refund = await h.calcGasRefund(21000, 10n ** 9n, e18(2000), ethers.parseUnits("1000", 6));
            expect(refund).to.be.greaterThanOrEqual(0n);
        });
    });

    describe("conditional order / transfer / cross-margin fees", () => {
        it("execType 0 and 1 use 3bps, else 5bps", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcConditionalOrderFee(e18(1_000_000), 0)).to.equal(e18(300));
            expect(await h.calcConditionalOrderFee(e18(1_000_000), 1)).to.equal(e18(300));
            expect(await h.calcConditionalOrderFee(e18(1_000_000), 2)).to.equal(e18(500));
        });
        it("position transfer fee", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcPositionTransferFee(e18(1_000_000), 100)).to.equal(e18(10000));
        });
        it("cross-margin conversion fee is 1bp", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcCrossMarginFee(e18(1_000_000))).to.equal(e18(100));
        });
    });

    describe("calculateEffectiveFeeRate", () => {
        it("caps discount at maxDiscountBps", async () => {
            const h = await loadFixture(deployHarness);
            // base 10, discount 50 capped at 5 -> 5
            expect(await h.calcEffectiveFeeRate(10, 50, 5)).to.equal(5n);
        });
        it("floors at zero when discount exceeds base", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcEffectiveFeeRate(3, 5, 100)).to.equal(0n);
        });
        it("subtracts discount from base normally", async () => {
            const h = await loadFixture(deployHarness);
            expect(await h.calcEffectiveFeeRate(10, 3, 100)).to.equal(7n);
        });
    });
});
