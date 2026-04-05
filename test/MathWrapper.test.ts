import { expect } from "chai";
import { ethers } from "hardhat";

describe("MathWrapper - Library Unit Tests", function () {
    let math: any;

    beforeEach(async () => {
        const MathWrapper = await ethers.getContractFactory("MathWrapper");
        math = await MathWrapper.deploy();
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
