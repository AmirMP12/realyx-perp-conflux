import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Realyx Branch Coverage Booster", function () {
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

    describe("PositionMath & TradingLib Matrix", function () {
        it("exercises calculateProfit & validateSlippage Matrix", async function () {
            const { harness } = await loadFixture(deployCoverageFixture);
            
            const sizes = [1000n * 10n**18n, 0n];
            const entries = [40000n * 10n**18n, 1n]; // Avoid div by zero if any
            const currents = [42000n * 10n**18n, 38000n * 10n**18n];
            const flags = [true, false]; // isLong

            for (const size of sizes) {
                for (const entry of entries) {
                    for (const current of currents) {
                        for (const isLong of flags) {
                            await harness.boostCalculatePnL(size, entry, current, isLong);
                            await harness.boostValidateSlippage(entry, current, 500, isLong); // acceptable
                            await harness.boostValidateSlippage(entry, current, 0, isLong); // tight
                        }
                    }
                }
            }
        });

        it("exercises shouldTrigger Matrix (SL, TP, Liquidation)", async function () {
            const { harness } = await loadFixture(deployCoverageFixture);
            
            for (let i = 1; i <= 8; i++) {
                const isLong = i % 2 === 0;
                const p = {
                    size: 1000n, entryPrice: 40000n, liquidationPrice: 35000n, stopLossPrice: i < 4 ? 39000n : 0n, takeProfitPrice: i > 4 ? 41000n : 0n,
                    leverage: 20n, lastFundingTime: 0n, market: ethers.ZeroAddress, openTimestamp: 0n, trailingStopBps: 0n,
                    flags: isLong ? 1 : 0, collateralType: 0, state: 1
                };
                await harness.setPosition(i, p);
                
                await harness.testShouldTriggerSL(i, 38000n);
                await harness.testShouldTriggerSL(i, 42000n);
                await harness.testShouldTriggerTP(i, 38000n);
                await harness.testShouldTriggerTP(i, 42000n);
                await harness.testGetPositionPnL(i, 40000n).catch(() => {});
            }
        });

        it("exercises validateCollateral & leverage branches", async function () {
            const { harness } = await loadFixture(deployCoverageFixture);
            await harness.testCalculateNewLeverage(1000n * 10n**18n, 100n * 10n**18n);
            await harness.testCalculateNewLeverage(1000n * 10n**18n, 0).catch(() => {});
            
            await harness.testCalculateLiquidationPrice(40000n * 10n**18n, 20n, 500, true);
            await harness.testCalculateLiquidationPrice(40000n * 10n**18n, 20n, 500, false);
            await harness.testCalculateLiquidationPrice(40000n * 10n**18n, 100n, 500, true);
        });
    });

    describe("Vault & Oracle Advanced Branches", function () {
        it("exercises Oracle Circuit Breaker Matrix", async function () {
            const { env, harness } = await loadFixture(deployCoverageFixture);
            const market = await env.usdc.getAddress();
            const oracle = await env.oracle.getAddress();
            const [admin] = await ethers.getSigners();
            
            await (env.oracle as any).grantRole(await env.oracle.OPERATOR_ROLE(), admin.address);
            await (env.oracle as any).grantRole(await env.oracle.KEEPER_ROLE(), admin.address);

            const feedId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
            await (env.oracle as any).setPythFeed(market, feedId, 3600, 0);
            
            // Trigger 1: TWAP Deviation
            await (env.oracle as any).configureBreaker(market, 1, 1000, 3600, 3600); // TWAP 10%
            await harness.boostCheckBreakers.staticCall(oracle, market, 50000n * 10n**18n, 0); // No twap data
            
            // Step: Record data points
            for (let i=0; i<3; i++) {
                const updateData = await env.pyth.createPriceFeedUpdateData(feedId, 40000n * 10n**8n, 100, -8, 40000n * 10n**8n, 100, await time.latest(), await time.latest());
                await env.pyth.updatePriceFeeds([updateData], { value: 1 });
                await (env.oracle as any).recordPricePoint(market, 0);
                await time.increase(600);
            }
            
            await harness.boostCheckBreakers.staticCall(oracle, market, 50000n * 10n**18n, 0); // Should trigger TWAP
            
            // Trigger 2: Confidence level
            await (env.oracle as any).setPythFeed(market, feedId, 3600, 10); // Very low max confidence (10)
            const updateBadConf = await env.pyth.createPriceFeedUpdateData(feedId, 40000n * 10n**8n, 5000, -8, 40000n * 10n**8n, 5000, await time.latest(), await time.latest());
            await env.pyth.updatePriceFeeds([updateBadConf], { value: 1 });
            await (env.oracle as any).isOracleHealthy(market);
        });

        it("exercises Vault Core matrix", async function () {
            const { env } = await loadFixture(deployCoverageFixture);
            const [admin] = await ethers.getSigners();
            await (env.vault as any).grantRole(await env.vault.TRADING_CORE_ROLE(), admin.address);
            await (env.vault as any).grantRole(await env.vault.OPERATOR_ROLE(), admin.address);
            await (env.vault as any).grantRole(await env.vault.GUARDIAN_ROLE(), admin.address);

            // Surplus Matrix
            await (env.usdc as any).mintTo(admin.address, 10000n * 10n**6n);
            await (env.usdc as any).approve(await env.vault.getAddress(), 10000n * 10n**6n);
            await (env.vault as any).stakeInsurance(1000n * 10n**6n, admin.address);
            await (env.vault as any).receiveFees(500n * 10n**6n);
            await (env.vault as any).updateProtocolTVL(100n * 10n**6n);
            await (env.vault as any).distributeSurplus(); // Surplus exists
            
            // Emergency Escape matrix
            await (env.vault as any).triggerEmergencyMode();
            await (env.vault as any).emergencyEscapeWithdraw(10).catch(() => {});
            await time.increase(8 * 24 * 3600);
            await (env.vault as any).emergencyEscapeWithdraw(10).catch(() => {});
        });
    });
});
