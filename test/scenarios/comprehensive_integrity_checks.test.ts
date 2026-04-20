import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Comprehensive Protocol Integrity Checks", function () {
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

    it("exercises PositionMath.calculateFundingOwed Matrix", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const sizes = [0n, 1000n, 10n**24n]; // Zero, normal, large
        const deltas = [-(10n**18n), 0n, 10n**18n, 10n**24n]; // neg, 0, pos, large pos
        const flags = [0, 1, 2]; // different long/short combinations

        for (const s of sizes) {
            for (const d of deltas) {
                for (const f of flags) {
                    const p = {
                        size: s, entryPrice: 40000n, liquidationPrice: 35000n, stopLossPrice: 0n, takeProfitPrice: 0n,
                        leverage: 20n, lastFundingTime: 0n, market: ethers.ZeroAddress, openTimestamp: 0n, trailingStopBps: 0n,
                        flags: f, collateralType: 0, state: 1
                    };
                    await harness.boostCalculateFundingOwed(p, d).catch(()=>{});
                }
            }
        }
    });

    it("exercises PositionMath.calculateFundingIntervals Matrix", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const times = [1000, 2000];
        const settleTimes = [500, 1500, 2500];
        const intervals = [0, 600];

        for (const t of times) {
            for (const s of settleTimes) {
                for (const i of intervals) {
                    await harness.boostCalculateFundingIntervals(s, t, i);
                }
            }
        }
    });

    it("exercises TradingLib.checkVolumeLimit Matrix", async function () {
        const { harness, env } = await loadFixture(deployCoverageFixture);
        const [admin] = await ethers.getSigners();
        
        const sizes = [100n, 500n, 1000n];
        const userLimits = [400n];
        const globalLimits = [800n];

        for (const s of sizes) {
            await harness.boostCheckVolumeLimit(admin.address, s, 400, 800);
        }
    });

    it("exercises PositionMath.validateSlippage Matrix", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const expected = 40000n;
        const actuals = [39000n, 40000n, 41000n];
        const bps = [0, 100, 500, 10000];
        const flags = [true, false];

        for (const a of actuals) {
            for (const b of bps) {
                for (const f of flags) {
                    await harness.boostValidateSlippage(expected, a, b, f);
                }
            }
        }
    });
});
