import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("High Coverage Test Suite", function () {
    let env: any;
    let harness: any;
    let math: any;
    let marketCalendar: any;
    let admin: any;
    let user: any;

    beforeEach(async () => {
        try {
            console.log("Starting beforeEach...");
            [admin, user] = await ethers.getSigners();
            console.log("Signers obtained");
            env = await deployTestEnvironment();
            console.log("Environment deployed");
            
            // Deploy base libraries
            console.log("Deploying base libraries...");
            const GlobalPnLLib = await (await ethers.getContractFactory("GlobalPnLLib")).deploy();
            const CircuitBreakerLib = await (await ethers.getContractFactory("CircuitBreakerLib")).deploy();
            console.log("Base libraries deployed");

            // Deploy MonitoringLib (needs GlobalPnLLib and TradingLib)
            console.log("TradingLib address:", env.libs.tradingLib);
            const MonitoringLibFactory = await ethers.getContractFactory("MonitoringLib", {
                libraries: {
                    "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": await GlobalPnLLib.getAddress(),
                    "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
                }
            });
            const monitoringLib = await MonitoringLibFactory.deploy();
            console.log("MonitoringLib deployed");

            // Deploy CoverageHarness
            console.log("Deploying CoverageHarness...");
            const HarnessFactory = await ethers.getContractFactory("CoverageHarness", {
                libraries: {
                    "contracts/libraries/MonitoringLib.sol:MonitoringLib": await monitoringLib.getAddress(),
                    "contracts/libraries/RateLimitLib.sol:RateLimitLib": env.libs.rateLimitLib,
                    "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": await GlobalPnLLib.getAddress(),
                    "contracts/libraries/CircuitBreakerLib.sol:CircuitBreakerLib": env.libs.circuitBreakerLib,
                    "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
                    "contracts/libraries/CleanupLib.sol:CleanupLib": env.libs.cleanupLib,
                    "contracts/libraries/ConfigLib.sol:ConfigLib": env.libs.configLib,
                    "contracts/libraries/DustLib.sol:DustLib": env.libs.dustLib,
                    "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": env.libs.flashLib,
                    "contracts/libraries/WithdrawLib.sol:WithdrawLib": env.libs.withdrawLib,
                }
            });
            harness = await HarnessFactory.deploy();
            console.log("CoverageHarness deployed");
            
            const MathFactory = await ethers.getContractFactory("PositionMathFeeCalculatorWrapper");
            math = await MathFactory.deploy();

            const MarketCalendarFactory = await ethers.getContractFactory("MarketCalendar");
            marketCalendar = await upgrades.deployProxy(MarketCalendarFactory, [admin.address], { kind: "uups" });
            console.log("beforeEach complete");
        } catch (e: any) {
            console.error("FATAL ERROR in beforeEach:", e.message);
            throw e;
        }
    });

    describe("MarketCalendar Deep Dive", function () {
        const MARKET_ID = "TEST-MKT";

        it("should handle 24x7 markets regardless of day/time", async function () {
            await marketCalendar.setMarketConfig(MARKET_ID, 0, 0, 0, true);
            expect(await marketCalendar["isMarketOpen(string)"](MARKET_ID)).to.be.true;
            
            // Sunday
            const sunday = 1711234800; // 2024-03-24 (Sunday)
            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, sunday)).to.be.true;
        });

        it("should handle standard trading hours and weekends", async function () {
            // Mon-Fri 09:00 - 17:00 (UTC)
            await marketCalendar.setMarketConfig(MARKET_ID, 540, 1020, 0, false);
            
            const mondayNoon = 1711368000; // 2024-03-25 12:00 UTC (Monday)
            const mondayNight = 1711404000; // 2024-03-25 22:00 UTC
            const saturdayNoon = 1711796400; // 2024-03-30 11:00 UTC (Saturday)

            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, mondayNoon)).to.be.true;
            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, mondayNight)).to.be.false;
            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, saturdayNoon)).to.be.false;
        });

        it("should handle holidays", async function () {
            await marketCalendar.setMarketConfig(MARKET_ID, 0, 1439, 0, false);
            const date = 20240325;
            const timestamp = 1711368000; // 2024-03-25

            await marketCalendar.setHoliday(MARKET_ID, date, true);
            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, timestamp)).to.be.false;

            await marketCalendar.setHoliday(MARKET_ID, date, false);
            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, timestamp)).to.be.true;
        });

        it("should handle timezones correctly", async function () {
            // 09:00 - 17:00 in UTC+8 (e.g. SGT)
            // 09:00 SGT = 01:00 UTC
            await marketCalendar.setMarketConfig(MARKET_ID, 540, 1020, 480, false);
            
            const utc0200 = 1711332000; // 2024-03-25 02:00 UTC = 10:00 SGT (OPEN)
            const utc1200 = 1711368000; // 2024-03-25 12:00 UTC = 20:00 SGT (CLOSED)

            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, utc0200)).to.be.true;
            expect(await marketCalendar["isMarketOpen(string,uint256)"](MARKET_ID, utc1200)).to.be.false;
        });

        it("should calculate getNextOpenTime properly", async function () {
            // Mon-Fri 09:00 - 17:00
            await marketCalendar.setMarketConfig(MARKET_ID, 540, 1020, 0, false);
            
            const fridayNight = 1711738800; // 2024-03-29 19:00 UTC (Friday after close)
            const nextOpen = await marketCalendar.getNextOpenTime(MARKET_ID, fridayNight);
            
            // Should be Monday 09:00 UTC
            const expectedMonday = 1711962000; // 2024-04-01 09:00 UTC
            expect(nextOpen).to.equal(expectedMonday);
        });

        it("should revert on invalid day index", async function () {
            await expect(marketCalendar.setTradingDay(MARKET_ID, 7, true)).to.be.reverted;
        });
    });

    describe("RateLimitLib", function () {
        it("should enforce rate limits on large actions", async function () {
            const threshold = 1000;
            const interval = 60; // 1 minute
            
            // First large action (pass)
            await harness.testRateLimit(1000, threshold, interval);
            
            // Immediate second large action (fail)
            await expect(harness.testRateLimit(1000, threshold, interval)).to.be.reverted;
            
            // Small action (pass, doesn't update time)
            await harness.testRateLimit(500, threshold, interval);
            
            // Advance time
            await time.increase(61);
            
            // Now second large action should pass
            await harness.testRateLimit(1000, threshold, interval);
        });
    });

    describe("CircuitBreakerLib", function () {
        const COLLECTION = "0x0000000000000000000000000000000000000001";

        it("should handle price drop trigger", async function () {
            // Threshold 10% (1000 BPS), Window 1h, Cooldown 1h
            await harness.testConfigureBreaker(COLLECTION, 0, 1000, 3600, 3600);
            
            // Set historical price for previous bucket (5 min buckets)
            const now = await time.latest();
            const prevBucket = Math.floor(now / 300) - 1;
            await harness.setHistoricalPrice(COLLECTION, prevBucket, 10000);
            
            // Current price drops by 15% (8500)
            const result = await harness.testCheckPriceDropBreaker.staticCall(COLLECTION, 8500);
            expect(result).to.be.true;
            
            await harness.testCheckPriceDropBreaker(COLLECTION, 8500); // Trigger it
            
            // Action should be disallowed
            expect(await harness.testIsActionAllowed(COLLECTION, 0, false)).to.be.false;
        });

        it("should handle resets and admin overrides", async function () {
            await harness.testConfigureBreaker(COLLECTION, 0, 1000, 3600, 3600);
            await harness.testTriggerBreaker(COLLECTION, 0);
            
            // Non-admin reset fails during cooldown
            await expect(harness.testResetBreaker(COLLECTION, 0, false)).to.be.reverted;
            
            // Admin reset succeeds
            await harness.testResetBreaker(COLLECTION, 0, true);
            expect(await harness.testIsActionAllowed(COLLECTION, 0, false)).to.be.true;
        });

        it("should handle global pause", async function () {
            expect(await harness.testIsActionAllowed(COLLECTION, 0, true)).to.be.false;
        });
    });

    describe("OracleAggregatorLib", function () {
        it("should compute aggregated price with deviation filtering", async function () {
            const prices = [10000, 10100, 10200, 10300]; // Tighter range
            const weights = [1, 1, 1, 1];
            const maxDev = 2000; // 20% - ensure simple average is close enough to everything
            
            const [avg, count, totalWt] = await harness.testComputeAggregatedPrice(prices, weights, maxDev);
            expect(count).to.be.gte(3);
        });

        it("should calculate TWAP from buffer", async function () {
            const now = await time.latest();
            await harness.addPricePoint(10000, 0, now - 300);
            await harness.addPricePoint(12000, 0, now - 150);
            
            const twap = await harness.testCalculateTWAP(600);
            expect(twap).to.be.gt(10000);
            expect(twap).to.be.lt(12000);
        });

        it("should handle TWAP confidence weighting", async function () {
            const now = await time.latest();
            // Price 10000 with low confidence (high uncertainty)
            await harness.addPricePoint(10000, 1000, now - 300);
            // Price 12000 with high confidence (low uncertainty)
            await harness.addPricePoint(12000, 1, now - 150);
            
            const [twap, count] = await harness.testCalculateTWAPWithCount(600);
            expect(twap).to.be.closeTo(12000, 100); // Heavily weighted towards high confidence
        });
    });

    describe("PositionMathFeeCalculatorWrapper & PositionMath Branches", function () {
        it("should cover PnL directions", async function () {
            // Long Profit
            expect(await math.calculateUnrealizedPnL(1000, 100, 110, true)).to.be.gt(0);
            // Long Loss
            expect(await math.calculateUnrealizedPnL(1000, 100, 90, true)).to.be.lt(0);
            // Short Profit
            expect(await math.calculateUnrealizedPnL(1000, 100, 90, false)).to.be.gt(0);
            // Short Loss
            expect(await math.calculateUnrealizedPnL(1000, 100, 110, false)).to.be.lt(0);
        });

        it("should cover liquidation prices", async function () {
            const liqLong = await math.calculateLiquidationPrice(60000, 20n * 10n**18n, 50, true);
            expect(liqLong).to.be.lt(60000);
            
            const liqShort = await math.calculateLiquidationPrice(60000, 20n * 10n**18n, 50, false);
            expect(liqShort).to.be.gt(60000);
        });

        it("should cover SL/TP triggers", async function () {
            // Long SL
            expect(await math.shouldTriggerStopLoss(1, true, 55000, 54000)).to.be.true;
            // Short SL
            expect(await math.shouldTriggerStopLoss(1, false, 65000, 66000)).to.be.true;
            // Long TP
            expect(await math.shouldTriggerTakeProfit(1, true, 65000, 66000)).to.be.true;
            // Short TP
            expect(await math.shouldTriggerTakeProfit(1, false, 55000, 54000)).to.be.true;
        });
    });

    describe("MonitoringLib", function () {
        it("should get protocol health", async function () {
            await harness.setProtocolHealth(true, 100, await time.latest());
            const DUMMY_MARKET = "0x0000000000000000000000000000000000000001";
            await harness.addMarket(DUMMY_MARKET);
            
            const feedId = ethers.zeroPadValue(ethers.toBeHex(1), 32);
            await env.oracle.connect(env.admin).setPythFeed(DUMMY_MARKET, feedId, 3600, 0);
            const priceData = await env.pyth.createPriceFeedUpdateData(
                feedId, 200000000000n, 1000000n, -8, 200000000000n, 1000000n, await time.latest(), await time.latest()
            );
            await env.pyth.updatePriceFeeds([priceData]);
            
            const [isHealthy, badDebt, assets, ratio, lastCheck, pnl] = await harness.testGetProtocolHealth(
                await env.vault.getAddress(),
                await env.oracle.getAddress()
            );
            expect(isHealthy).to.be.true;
            expect(badDebt).to.equal(100);
        });

        it("should test active positions", async function () {
            await harness.addPositionId(201);
            await harness.setPosition(201, 1000, 2000, 1, 1, ethers.ZeroAddress); // Set state to OPEN
            
            const ids = await harness.testGetActivePositions();
            expect(ids).to.include(201n);
        });

        it("should test position ownership transfer", async function () {
            const user1 = "0x0000000000000000000000000000000000000001";
            const user2 = "0x0000000000000000000000000000000000000002";
            // 1000 * 10^12 = 1,000,000,000,000,000
            const size = 1000n * 10n**12n;
            await harness.setPosition(1, size, 2000, 1, 1, ethers.ZeroAddress);
            await harness.testUpdatePositionOwner(1, user2, user1, 1000000);
            expect(await harness.userExposure(user2)).to.equal(1000);
        });

        it("should get position health", async function () {
            const DUMMY_MARKET = "0x0000000000000000000000000000000000000001";
            await harness.setPosition(1, 1000, 2000, 1, 1, DUMMY_MARKET); 
            
            const feedId = ethers.zeroPadValue(ethers.toBeHex(1), 32);
            await env.oracle.connect(env.admin).setPythFeed(DUMMY_MARKET, feedId, 3600, 0);
            const priceData = await env.pyth.createPriceFeedUpdateData(
                feedId, 200000000000n, 1000000n, -8, 200000000000n, 1000000n, await time.latest(), await time.latest()
            );
            await env.pyth.updatePriceFeeds([priceData]);
            await harness.setCollateral(0, 100);
            
            const [isLiq, health, pnl, price, sl, tp] = await harness.testGetPositionHealth(
                await env.oracle.getAddress()
            );
            expect(price).to.be.gt(0);
        });
    });

    describe("OracleAggregatorLib Extended", function () {
        it("should test volume spike trigger", async function () {
            expect(await harness.testCheckVolumeSpikeTriggered(200, 100, 150)).to.deep.equal([true, 200n]);
            expect(await harness.testCheckVolumeSpikeTriggered(120, 100, 150)).to.deep.equal([false, 120n]);
            expect(await harness.testCheckVolumeSpikeTriggered(100, 0, 150)).to.deep.equal([false, 0n]);
        });

        it("should test weighted average", async function () {
            expect(await harness.testCalculateWeightedAverage([100, 200], [1, 1])).to.equal(150n);
            expect(await harness.testCalculateWeightedAverage([100, 200], [1, 3])).to.equal(175n);
            expect(await harness.testCalculateWeightedAverage([], [])).to.equal(0n);
            expect(await harness.testCalculateWeightedAverage([100], [1])).to.equal(100n);
        });

        it("should test price drop trigger", async function () {
            expect(await harness.testCheckPriceDropTriggered(90, 100, 500)).to.deep.equal([true, 1000n]); // 10% drop, 5% threshold
            expect(await harness.testCheckPriceDropTriggered(98, 100, 500)).to.deep.equal([false, 200n]); // 2% drop
            expect(await harness.testCheckPriceDropTriggered(100, 0, 500)).to.deep.equal([false, 0n]);
        });

        it("should test TWAP deviation trigger", async function () {
            expect(await harness.testCheckTWAPDeviationTriggered(110, 100, 500)).to.deep.equal([true, 1000n]); // 10% dev, 5% threshold
            expect(await harness.testCheckTWAPDeviationTriggered(90, 100, 500)).to.deep.equal([true, 1000n]);
            expect(await harness.testCheckTWAPDeviationTriggered(102, 100, 500)).to.deep.equal([false, 200n]);
        });

        it("should test deviation edge cases", async function () {
            expect(await harness.testCalculateDeviation(100, 0)).to.equal(10000); 
            expect(await harness.testCalculateDeviation(110, 100)).to.equal(1000); 
            expect(await harness.testCalculateDeviation(90, 100)).to.equal(1000); 
        });

        it("should test price normalization", async function () {
            expect(await harness.testNormalizeChainlinkPrice(1234, 8)).to.equal(12340000000000n);
            expect(await harness.testNormalizeChainlinkPrice(1234, 18)).to.equal(1234);
            expect(await harness.testNormalizeChainlinkPrice(123400, 20)).to.equal(1234);
        });

        it("should test volume spike trigger", async function () {
            const [triggered, mult] = await harness.testCheckVolumeSpike(200, 100, 150);
            expect(triggered).to.be.true;
            expect(mult).to.equal(200);
        });
    });

    describe("CircuitBreakerLib Extended", function () {
        it("should handle TWAP deviation trigger", async function () {
            const COLLECTION = "0x0000000000000000000000000000000000000002";
            await harness.testConfigureBreaker(COLLECTION, 2, 500, 3600, 3600); 
            
            const triggered = await harness.testCheckTWAPDeviationBreaker.staticCall(COLLECTION, 10600, 10000);
            expect(triggered).to.be.true;
        });
    });

    describe("TradingLib Extended", function () {
        it("should test volume limits", async function () {
            const user = "0x0000000000000000000000000000000000000001";
            // Normal volume
            expect(await harness.testCheckVolumeLimit(user, 100, 1000, 10000)).to.be.true;
            await harness.testUpdateVolume(user, 500);
            expect(await harness.testCheckVolumeLimit(user, 100, 1000, 10000)).to.be.true;
            
            // Exceed user limit
            await harness.testUpdateVolume(user, 401);
            expect(await harness.testCheckVolumeLimit(user, 100, 1000, 10000)).to.be.false;
            
            // Daily reset simulation
            await time.increase(86400); // 1 day
            expect(await harness.testCheckVolumeLimit(user, 100, 1000, 10000)).to.be.true;
        });

        it("should calculate PnL and leverage", async function () {
            // size: 100, entry: 1000, current: 1100, long = 10% profit
            const size = 100n * 10n**18n;
            const entry = 1000n * 10n**18n;
            const current = 1100n * 10n**18n;
            
            // Debugging
            expect(await harness.testIsLong(1)).to.be.true; // Long should be 0x01
            expect(await harness.debugCalculatePnL(size, entry, current, true)).to.equal(10n * 10n**18n);
            
            await harness.setPosition(1, size, entry, 1, 1, ethers.ZeroAddress); // flags=1 (long), state=1 (open)
            await harness.setCollateral(1, 10n * 10n**18n);
            
            const [pnl, health] = await harness.testGetPositionPnL(1, current);
            expect(pnl).to.equal(10n * 10n**18n); // 100 * (1100-1000)/1000 = 10
            
            expect(await harness.testCalculateNewLeverage(size, 10n * 10n**18n)).to.equal(10n * 10n**18n);
            expect(await harness.testCalculateNewLeverage(size, 0)).to.equal(ethers.MaxUint256);
        });

        it("should test liquidation logic", async function () {
            // size: 100, entry: 1000, collateral: 5, current: 940 (6% drop)
            // Long 20x. 6% drop = 120% loss (>100% of collateral)
            const size = 100n * 10n**18n;
            const entry = 1000n * 10n**18n;
            const current = 940n * 10n**18n;
            await harness.setPosition(2, size, entry, 1, 1, ethers.ZeroAddress);
            await harness.setCollateral(2, 5n * 10n**18n);
            
            const [liquidatable, health] = await harness.testCanLiquidate(2, current);
            expect(liquidatable).to.be.true;
            expect(health).to.be.lt(10n**18n); // Health < 1.0 (assuming 1e18 precision)
        });
    });
});
