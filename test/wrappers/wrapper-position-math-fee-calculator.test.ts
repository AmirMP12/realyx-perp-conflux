import { expect } from "chai";
import { ethers } from "hardhat";

describe("PositionMathFeeCalculatorWrapper - Library Unit Tests", function () {
    let math: any;

    beforeEach(async () => {
        const Factory = await ethers.getContractFactory("PositionMathFeeCalculatorWrapper");
        math = await Factory.deploy();
    });

    describe("PositionMath", function () {
        it("should calculate correct unrealized PNL (Long Profit)", async function () {
            const size = ethers.parseUnits("1", 18);
            const entry = ethers.parseUnits("3000", 18);
            const current = ethers.parseUnits("3100", 18);
            const pnl = await math.calculateUnrealizedPnL(size, entry, current, true);
            expect(pnl).to.be.gt(0);
        });

        it("should calculate correct liquidation price (Long)", async function () {
            const entry = ethers.parseUnits("3000", 18);
            const leverage = ethers.parseUnits("10", 18);
            const mm = 500n; // 5%
            const liqPrice = await math.calculateLiquidationPrice(entry, leverage, mm, true);
            expect(liqPrice).to.be.lt(entry);
        });

        it("should cover PnL percent, funding, slippage, and safeMul branches", async function () {
            const p = ethers.parseUnits("1", 18);
            const collateral = ethers.parseUnits("100", 18);
            const expectedPct = (p * ethers.parseUnits("1", 18)) / collateral;
            expect(await math.calculatePnLPercent(p, collateral)).to.equal(expectedPct);

            await expect(math.calculatePnLPercent(1n, 0n)).to.be.reverted;

            const base = 10n ** 14n;
            expect(await math.calculateFundingRate(0n, 0n, base)).to.equal(0n);
            expect(await math.calculateFundingRate(100n * p, 50n * p, base)).to.be.gt(0n);
            expect(await math.calculateFundingRate(50n * p, 100n * p, base)).to.be.lt(0n);

            const hi = (1n << 96n) + 1n;
            expect(await math.calculateFundingOwedForPosition(hi, 1, base)).to.be.a("bigint");

            expect(await math.calculateFundingIntervals(100n, 99n, 3600n)).to.equal(0n);
            expect(await math.calculateFundingIntervals(100n, 8n * 3600n + 100n, 3600n)).to.equal(8n);

            expect(await math.validateSlippageExt(p, p, 100n, true)).to.equal(true);
            expect(await math.safeMulExt(0n, 99n)).to.equal(0n);
            expect(await math.safeMulExt(2n, 3n)).to.equal(6n);
        });
    });

    describe("FeeCalculator", function () {
        it("should calculate trading fee", async function () {
            const size = ethers.parseUnits("1000", 18);
            const maker = 10n; // 0.1%
            const taker = 20n; // 0.2%
            const fee = await math.calculateTradingFeeSimple(size, maker, taker, false);
            expect(fee).to.equal(ethers.parseUnits("2", 18));
        });

        it("should calculate liquidation fee tuple", async function () {
            const size = ethers.parseUnits("1000", 18);
            const hf = ethers.parseUnits("0.6", 18); // medium risk
            const [total, liq, ins] = await math.calculateLiquidationFee(size, hf);
            expect(total).to.be.gt(0);
            expect(liq).to.be.gt(0);
            expect(ins).to.be.gt(0);
        });
    });
});
