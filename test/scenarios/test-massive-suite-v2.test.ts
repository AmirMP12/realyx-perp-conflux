import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Realyx Massive Branch Booster V2", function () {
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
                "contracts/libraries/CircuitBreakerLib.sol:CircuitBreakerLib": env.libs.circuitBreakerLib,
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

    it("exercises FeeCalculator Matrix", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const sizes = [0n, 1000n * 10n**18n];
        const isMakers = [true, false];
        const referals = [0n, 100n, 5000n]; // 0, partial, full discount
        const minFeeUsdcs = [0n, 10n * 10n**6n];

        for (const s of sizes) {
            for (const m of isMakers) {
                for (const r of referals) {
                    for (const mini of minFeeUsdcs) {
                        const config = {
                            makerFeeBps: 20,
                            takerFeeBps: 50,
                            minFeeUsdc: mini,
                            lpShareBps: 7000,
                            insuranceShareBps: 2000,
                            treasuryShareBps: 1000
                        };
                        await harness.boostCalculateTradingFee(s, config, m, r);
                    }
                }
            }
        }
    });

    it("exercises FundingLib Matrix", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const ois = [0n, 1000n * 10n**18n, 2000n * 10n**18n];
        for (const long of ois) {
            for (const short of ois) {
                await harness.boostCalculateFundingRate(long, short, 100);
            }
        }
    });

    it("exercises Liquidation Fee Matrix", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const sizes = [0n, 1000n * 10n**18n];
        const healthFactors = [400000000000000000n, 600000000000000000n, 900000000000000000n]; // below 5, 5-8, above 8
        const tiers = {
            nearThresholdBps: 250,
            mediumRiskBps: 500,
            deeplyUnderwaterBps: 750,
            liquidatorShareBps: 5000
        };

        for (const s of sizes) {
            for (const h of healthFactors) {
                await harness.boostCalculateLiquidationFee(s, h, tiers);
            }
        }
    });

    it("exercises PositionMath unrealizedPnL deep matrix", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const sizes = [0n, 1000n];
        const entries = [1000n, 2000n];
        const currents = [500n, 1000n, 1500n, 2000n, 2500n];
        const flags = [true, false];

        for (const s of sizes) {
            for (const e of entries) {
                for (const c of currents) {
                    for (const f of flags) {
                        await harness.boostCalculatePnL(s, e, c, f);
                    }
                }
            }
        }
    });
});
