import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Final Validation and Logic Scenarios", function () {
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

    it("exercises PositionMath: Margin and Liquidation Branches", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);

        const sizes = [0n, 1000n * 10n**18n];
        const leverages = [0n, 5n, 10n, 50n];
        const baseMMs = [100, 200];
        
        for (const s of sizes) {
            for (const l of leverages) {
                // boostCalculateInitialMargin
                if (l === 0n) {
                    await expect(harness.boostCalculateInitialMargin(s, l)).to.be.reverted;
                } else {
                    await harness.boostCalculateInitialMargin(s, l);
                }
                
                // boostCalculateDynamicMM
                if (l > 0n) {
                    await harness.boostCalculateDynamicMM(s, l);
                }
            }
        }
        
        // boostCalculateMaintenanceMargin
        await harness.boostCalculateMaintenanceMargin(1000n * 10n**18n, 100); // above min
        await harness.boostCalculateMaintenanceMargin(100n * 10n**18n, 1);    // clamped to min

        // boostCalculateLiquidationPrice exhaustive
        const prices = [1000n, 2000n];
        for (const p of prices) {
            for (const l of leverages) {
                if (l === 0n) {
                    await expect(harness.boostCalculateLiquidationPrice(p, l, 500, true)).to.be.reverted;
                } else {
                    await harness.boostCalculateLiquidationPrice(p, l, 500, true);
                    await harness.boostCalculateLiquidationPrice(p, l, 500, false);
                }
            }
        }
    });

    it("exercises TradingLib: Price and Leverage Validation", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        
        // boostValidateOpeningPrice
        expect(await harness.boostValidateOpeningPrice(100n, 100n, 100)).to.be.true;
        expect(await harness.boostValidateOpeningPrice(100n, 80n, 100)).to.be.false;
        expect(await harness.boostValidateOpeningPrice(100n, 0n, 100)).to.be.false;
        
        // boostCalculateNewLeverage
        await harness.boostCalculateNewLeverage(1000n, 100n);
        await harness.boostCalculateNewLeverage(1000n, 0n);
    });

    it("exercises PositionMath: Unrealized and Realized PnL", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        await harness.boostCalculatePnL(1000n, 2000n, 2500n, true);  // Long profit
        await harness.boostCalculatePnL(1000n, 2000n, 1500n, true);  // Long loss
        await harness.boostCalculatePnL(1000n, 2000n, 1500n, false); // Short profit
        await harness.boostCalculatePnL(1000n, 2000n, 2500n, false); // Short loss
        await harness.boostCalculatePnL(0n, 2000n, 2500n, true);     // Zero size
        await expect(harness.boostCalculatePnL(1000n, 0n, 2500n, true)).to.be.reverted; // Zero entry
        
        await harness.boostCalculateRealizedPnL(1000n, 50n, 10n);
    });

    function uint128(n: bigint) { return n; }
    function uint64(n: bigint) { return n; }
});
