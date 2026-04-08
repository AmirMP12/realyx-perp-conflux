import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Libraries Mega Branch Wave", function () {
    async function deployCoverageFixture() {
        const env = await deployTestEnvironment();

        const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
            libraries: {
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
            }
        });
        const monitoringLib = await MonitoringLib.deploy();

        const CoverageHarness = await ethers.getContractFactory("CoverageHarness", {
            libraries: {
                "contracts/libraries/CleanupLib.sol:CleanupLib": env.libs.cleanupLib,
                "contracts/libraries/ConfigLib.sol:ConfigLib": env.libs.configLib,
                "contracts/libraries/DustLib.sol:DustLib": env.libs.dustLib,
                "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": env.libs.flashLib,
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/MonitoringLib.sol:MonitoringLib": await monitoringLib.getAddress(),
                "contracts/libraries/RateLimitLib.sol:RateLimitLib": env.libs.rateLimitLib,
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
                "contracts/libraries/WithdrawLib.sol:WithdrawLib": env.libs.withdrawLib,
            }
        });
        const harness = await CoverageHarness.deploy();
        return { env, harness };
    }

    it("covers OracleAggregatorLib weighted/deviation helper branches", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);

        expect(await harness.testCalculateWeightedAverage([], [])).to.equal(0n);
        expect(await harness.testCalculateWeightedAverage([99], [1])).to.equal(99n);
        expect(await harness.testCalculateWeightedAverage([0, 100, 200], [3, 1, 1])).to.equal(150n);

        expect(await harness.testCalculateDeviation(1, 0)).to.equal(10000n);
        expect(await harness.testCalculateDeviation(90, 100)).to.equal(1000n);
        expect(await harness.testCalculateDeviation(110, 100)).to.equal(1000n);

        const [agg, valid, totalW] = await harness.testComputeAggregatedPrice(
            [100, 101, 102, 0],
            [1, 2, 1, 5],
            200
        );
        expect(agg).to.equal(101n);
        expect(valid).to.equal(3n);
        expect(totalW).to.equal(4n);
    });

    it("covers OracleAggregatorLib TWAP no-data and valid-data branches", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const now = await time.latest();

        await expect(harness.testCalculateTWAP(3600)).to.be.reverted;
        await expect(harness.testCalculateTWAPWithCount(3600)).to.be.reverted;

        await harness.addPricePoint(100n, 5, now - 50_000);
        await expect(harness.testCalculateTWAP(60)).to.be.reverted;
        await expect(harness.testCalculateTWAPWithCount(60)).to.be.reverted;

        await harness.addPricePoint(100n, 1, now - 50);
        await harness.addPricePoint(110n, 2, now - 20);
        await harness.addPricePoint(120n, 3, now - 5);

        const twap = await harness.testCalculateTWAP(120);
        expect(twap).to.be.gt(0n);
        const [twap2, count2] = await harness.testCalculateTWAPWithCount(120);
        expect(twap2).to.be.gt(0n);
        expect(count2).to.be.gte(1n);
    });

    it("covers CircuitBreakerLib config/trigger/reset/action branches", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const market = ethers.Wallet.createRandom().address;
        const PRICE_DROP = 0;
        const TWAP_DEV = 2;
        const EMERGENCY = 5;

        await expect(harness.testConfigureBreaker(market, PRICE_DROP, 500, 0, 10)).to.be.reverted;
        await expect(harness.testConfigureBreaker(market, PRICE_DROP, 500, 10, 0)).to.be.reverted;
        await expect(harness.testTriggerBreaker(market, PRICE_DROP)).to.be.reverted;

        await harness.testConfigureBreaker(market, PRICE_DROP, 500, 300, 120);
        await harness.testConfigureBreaker(market, TWAP_DEV, 400, 300, 120);

        expect(await harness.testCheckPriceDropBreaker.staticCall(market, 100)).to.equal(false);
        const bucket = BigInt(Math.floor((await time.latest()) / 300) - 1);
        await harness.setHistoricalPrice(market, bucket, 1000);
        await harness.testCheckPriceDropBreaker(market, 900);

        await harness.testTriggerBreaker(market, TWAP_DEV);
        await expect(harness.testResetBreaker(market, TWAP_DEV, false)).to.be.reverted;
        await harness.testResetBreaker(market, TWAP_DEV, true);
        expect(await harness.testCheckTWAPDeviationBreaker.staticCall(market, 1500, 1000)).to.equal(true);
        await harness.testCheckTWAPDeviationBreaker(market, 1500, 1000);
        expect(await harness.testIsActionAllowed(market, 0, false)).to.equal(false);
        expect(await harness.testIsActionAllowed(market, 1, false)).to.equal(true);

        await harness.testConfigureBreaker(market, EMERGENCY, 1, 10, 10);
        await harness.testTriggerBreaker(market, EMERGENCY);
        expect(await harness.testIsActionAllowed(market, 1, false)).to.equal(false);
        expect(await harness.testIsActionAllowed(market, 1, true)).to.equal(false);
    });

    it("covers DataTypes helper branches via harness wrappers", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);

        expect(await harness.testIsLong(0)).to.equal(false);
        expect(await harness.testIsLong(1)).to.equal(true);
        expect(await harness.testIsCrossMargin(0)).to.equal(false);
        expect(await harness.testIsCrossMargin(2)).to.equal(true);

        expect(await harness.testToUsdcPrecisionCeil(0)).to.equal(0n);
        expect(await harness.testToUsdcPrecisionCeil(1)).to.equal(1n);
        expect(await harness.testToUsdcPrecisionCeil(1_000_000_000_001n)).to.equal(2n);
    });
});
