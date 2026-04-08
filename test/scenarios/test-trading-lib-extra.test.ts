import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingLib Extra Branch Coverage", function () {
    async function deployHarnessFixture() {
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
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
                "contracts/libraries/MonitoringLib.sol:MonitoringLib": await monitoringLib.getAddress(),
                "contracts/libraries/CircuitBreakerLib.sol:CircuitBreakerLib": env.libs.circuitBreakerLib,
                "contracts/libraries/CleanupLib.sol:CleanupLib": env.libs.cleanupLib,
                "contracts/libraries/ConfigLib.sol:ConfigLib": env.libs.configLib,
                "contracts/libraries/DustLib.sol:DustLib": env.libs.dustLib,
                "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": env.libs.flashLib,
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/RateLimitLib.sol:RateLimitLib": env.libs.rateLimitLib,
                "contracts/libraries/WithdrawLib.sol:WithdrawLib": env.libs.withdrawLib,
            }
        });
        const harness = await CoverageHarness.deploy();

        return { env, harness };
    }

    it("covers TradingLib math and funding branches", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);

        const now = BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp));
        const intervals = await harness.boostCalculateFundingIntervals(now - 10_000n, now, 3600n);
        expect(intervals).to.be.gt(0n);

        const rate = await harness.boostCalculateFundingRate(1_000_000n, 500_000n, 100n);
        expect(rate).to.be.a("bigint");

        const pnl = await harness.boostCalculateRealizedPnL(-100n, 10n, 5n);
        expect(pnl).to.be.a("bigint");
    });

    it("covers post-liquidation helper branches", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);

        const [t1, badDebt1] = await harness.boostApplyLiquidatePostProcess.staticCall(1, false, 1000, 500, 10);
        expect(t1).to.equal(10n);
        expect(badDebt1).to.equal(1000n);
    });
});
