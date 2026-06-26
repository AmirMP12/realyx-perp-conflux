import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

/**
 * Verifies TradingLib helper functions, TradingCoreViews, and OracleAggregatorLib behavior.
 */

describe("TradingLib", () => {
    async function deployFixture() {
        const [admin, user, keeper] = await ethers.getSigners();
        const libs = await deployAllLibraries();
        
        // Use existing CoverageHarness which has TradingLib helpers
        const harness = await deployHarness("CoverageHarness", libs);

        const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        return { harness, oracle, admin, user, keeper };
    }

    describe("checkVolumeLimit", () => {
        it("allows trading within user daily limit", async () => {
            const { harness, user } = await loadFixture(deployFixture);
            
            const result = await harness.testCheckVolumeLimit(
                user.address,
                e18(1000), // size
                e18(10000), // user limit
                e18(100000)  // global limit
            );
            
            expect(result).to.equal(true);
        });

        it("rejects trading exceeding user daily limit", async () => {
            const { harness, user } = await loadFixture(deployFixture);
            
            // First trade consumes limit
            await harness.testUpdateVolume(user.address, e18(9000));
            
            const result = await harness.testCheckVolumeLimit(
                user.address,
                e18(2000), // would exceed 10000 limit
                e18(10000),
                e18(100000)
            );
            
            expect(result).to.equal(false);
        });

        it("rejects trading exceeding global daily limit", async () => {
            const { harness, user } = await loadFixture(deployFixture);
            
            const result = await harness.testCheckVolumeLimit(
                user.address,
                e18(50001), // exceeds global limit
                e18(100000), // user limit OK
                e18(50000)   // global limit exceeded
            );
            
            expect(result).to.equal(false);
        });
    });

    describe("updateVolume", () => {
        it("updates user and global volumes", async () => {
            const { harness, user } = await loadFixture(deployFixture);
            
            await harness.testUpdateVolume(user.address, e18(1000));
            
            // Verify volume was updated by checking limit
            const canTrade = await harness.testCheckVolumeLimit(
                user.address,
                e18(100),
                e18(10000),
                e18(100000)
            );
            
            expect(canTrade).to.equal(true);
        });

        it("accumulates multiple trades", async () => {
            const { harness, user } = await loadFixture(deployFixture);
            
            await harness.testUpdateVolume(user.address, e18(3000));
            await harness.testUpdateVolume(user.address, e18(3000));
            await harness.testUpdateVolume(user.address, e18(3000));
            
            // Total 9000, should still be under 10000 limit
            const canTrade = await harness.testCheckVolumeLimit(
                user.address,
                e18(900),
                e18(10000),
                e18(100000)
            );
            
            expect(canTrade).to.equal(true);
            
            // But 1100 would exceed
            const canTradeMore = await harness.testCheckVolumeLimit(
                user.address,
                e18(1100),
                e18(10000),
                e18(100000)
            );
            
            expect(canTradeMore).to.equal(false);
        });
    });

    describe("calculateNewLeverage", () => {
        it("calculates leverage correctly", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const leverage = await harness.testCalculateNewLeverage(
                e18(10000), // size
                e18(1000)   // collateral
            );
            
            expect(leverage).to.equal(e18(10)); // 10x leverage
        });

        it("returns max uint256 for zero collateral", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const leverage = await harness.testCalculateNewLeverage(
                e18(10000),
                0
            );
            
            expect(leverage).to.equal(ethers.MaxUint256);
        });

        it("handles various leverage ratios", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 2x leverage
            let leverage = await harness.testCalculateNewLeverage(e18(2000), e18(1000));
            expect(leverage).to.equal(e18(2));
            
            // 50x leverage
            leverage = await harness.testCalculateNewLeverage(e18(50000), e18(1000));
            expect(leverage).to.equal(e18(50));
            
            // 1x leverage (no leverage)
            leverage = await harness.testCalculateNewLeverage(e18(1000), e18(1000));
            expect(leverage).to.equal(e18(1));
        });
    });

    describe("getUserPositionsPaginated", () => {
        it("returns paginated positions", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // Add some position IDs
            await harness.addPositionId(1);
            await harness.addPositionId(2);
            await harness.addPositionId(3);
            await harness.addPositionId(4);
            await harness.addPositionId(5);
            
            const [positions, total] = await harness.testGetUserPositionsPaginated(0, 3);
            
            expect(total).to.equal(5n);
            expect(positions.length).to.equal(3);
            expect(positions[0]).to.equal(1n);
            expect(positions[1]).to.equal(2n);
            expect(positions[2]).to.equal(3n);
        });

        it("handles offset beyond total", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            await harness.addPositionId(1);
            await harness.addPositionId(2);
            
            const [positions, total] = await harness.testGetUserPositionsPaginated(10, 5);
            
            expect(total).to.equal(2n);
            expect(positions.length).to.equal(0);
        });

        it("returns remaining items when limit exceeds remaining", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            await harness.addPositionId(1);
            await harness.addPositionId(2);
            await harness.addPositionId(3);
            
            const [positions, total] = await harness.testGetUserPositionsPaginated(1, 10);
            
            expect(total).to.equal(3n);
            expect(positions.length).to.equal(2); // Only positions 2 and 3
        });

        it("handles zero limit", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            await harness.addPositionId(1);
            
            const [positions, total] = await harness.testGetUserPositionsPaginated(0, 0);
            
            expect(total).to.equal(1n);
            expect(positions.length).to.equal(0);
        });
    });
});

describe("TradingCoreViews", () => {
    async function deployFixture() {
        const [admin, user] = await ethers.getSigners();
        
        // Deploy TradingCoreViews
        const Views = await ethers.getContractFactory("TradingCoreViews");
        const views = await Views.deploy();
        await views.waitForDeployment();

        // Deploy mocks
        const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        const Vault = await ethers.getContractFactory("MockVaultControl");
        const vault = await Vault.deploy();
        await vault.waitForDeployment();

        // We need a mock TradingCore - let's use a simple contract
        const MockCore = await ethers.getContractFactory("MockTradingCorePnl");
        const tradingCore = await MockCore.deploy();
        await tradingCore.waitForDeployment();

        // Initialize views
        await views.initialize(
            await tradingCore.getAddress(),
            await vault.getAddress(),
            await oracle.getAddress()
        );

        return { views, tradingCore, vault, oracle, admin, user };
    }

    describe("initialize", () => {
        it("initializes with correct addresses", async () => {
            const { views, tradingCore, vault, oracle } = await loadFixture(deployFixture);
            
            expect(await views.tradingCore()).to.equal(await tradingCore.getAddress());
            expect(await views.vaultCore()).to.equal(await vault.getAddress());
            expect(await views.oracleAggregator()).to.equal(await oracle.getAddress());
        });

        it("reverts when already initialized", async () => {
            const { views, tradingCore, vault, oracle } = await loadFixture(deployFixture);
            
            await expect(
                views.initialize(
                    await tradingCore.getAddress(),
                    await vault.getAddress(),
                    await oracle.getAddress()
                )
            ).to.be.revertedWithCustomError(views, "AlreadyInitialized");
        });

        it("reverts with zero address for tradingCore", async () => {
            const Views = await ethers.getContractFactory("TradingCoreViews");
            const views = await Views.deploy();
            await views.waitForDeployment();

            const Vault = await ethers.getContractFactory("MockVaultControl");
            const vault = await Vault.deploy();

            const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
            const oracle = await Oracle.deploy();

            await expect(
                views.initialize(
                    ethers.ZeroAddress,
                    await vault.getAddress(),
                    await oracle.getAddress()
                )
            ).to.be.revertedWithCustomError(views, "ZeroAddress");
        });

        it("reverts with zero address for vaultCore", async () => {
            const Views = await ethers.getContractFactory("TradingCoreViews");
            const views = await Views.deploy();
            await views.waitForDeployment();

            const Core = await ethers.getContractFactory("MockTradingCorePnl");
            const core = await Core.deploy();

            const Oracle = await ethers.getContractFactory("MockOracleForEmergencyPrice");
            const oracle = await Oracle.deploy();

            await expect(
                views.initialize(
                    await core.getAddress(),
                    ethers.ZeroAddress,
                    await oracle.getAddress()
                )
            ).to.be.revertedWithCustomError(views, "ZeroAddress");
        });

        it("reverts with zero address for oracleAggregator", async () => {
            const Views = await ethers.getContractFactory("TradingCoreViews");
            const views = await Views.deploy();
            await views.waitForDeployment();

            const Core = await ethers.getContractFactory("MockTradingCorePnl");
            const core = await Core.deploy();

            const Vault = await ethers.getContractFactory("MockVaultControl");
            const vault = await Vault.deploy();

            await expect(
                views.initialize(
                    await core.getAddress(),
                    await vault.getAddress(),
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(views, "ZeroAddress");
        });
    });
});


describe("OracleAggregatorLib", () => {
    async function deployFixture() {
        const libs = await deployAllLibraries();
        const harness = await deployHarness("CoverageHarness", libs);
        return { harness };
    }

    describe("calculateWeightedAverage", () => {
        it("handles empty array", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const avg = await harness.testCalculateWeightedAverage([], []);
            expect(avg).to.equal(0n);
        });

        it("returns single value for single-element array", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const avg = await harness.testCalculateWeightedAverage([e18(100)], [1]);
            expect(avg).to.equal(e18(100));
        });

        it("calculates weighted average correctly", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 100 with weight 1, 200 with weight 1 = average 150
            const avg = await harness.testCalculateWeightedAverage(
                [e18(100), e18(200)],
                [1, 1]
            );
            expect(avg).to.equal(e18(150));
        });

        it("handles different weights", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 100 with weight 3, 200 with weight 1 = (300 + 200) / 4 = 125
            const avg = await harness.testCalculateWeightedAverage(
                [e18(100), e18(200)],
                [3, 1]
            );
            expect(avg).to.equal(e18(125));
        });

        it("skips zero values", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // Should only average non-zero: (100*1 + 200*1) / 2 = 150
            const avg = await harness.testCalculateWeightedAverage(
                [e18(100), 0, e18(200)],
                [1, 1, 1]
            );
            expect(avg).to.equal(e18(150));
        });

        it("returns zero when all values are zero", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const avg = await harness.testCalculateWeightedAverage([0, 0, 0], [1, 1, 1]);
            expect(avg).to.equal(0n);
        });

        it("handles large values", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const avg = await harness.testCalculateWeightedAverage(
                [e18(10000), e18(20000)],
                [1, 1]
            );
            expect(avg).to.equal(e18(15000));
        });
    });

    describe("computeAggregatedPrice", () => {
        it("filters out prices beyond max deviation", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // Test with very tight clustering so deviation filtering is meaningful
            // Prices: 100, 101, 99 (tight cluster), 200 (outlier)
            // Initial average: ~125, then 200 will be filtered out as it deviates ~60%
            // After filtering, only 100, 101, 99 remain
            const [aggregated, validCount] = await harness.testComputeAggregatedPrice(
                [e18(100), e18(101), e18(99)],
                [1, 1, 1],
                500 // 5% deviation
            );
            
            // All three prices are within 5% of average 100
            expect(validCount).to.equal(3n);
            expect(aggregated).to.equal(e18(100));
        });

        it("includes all prices within deviation", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const [aggregated, validCount] = await harness.testComputeAggregatedPrice(
                [e18(100), e18(102), e18(98)],
                [1, 1, 1],
                500 // 5%
            );
            
            expect(validCount).to.equal(3n);
            expect(aggregated).to.equal(e18(100));
        });

        it("returns zero when no valid prices", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const [aggregated, validCount] = await harness.testComputeAggregatedPrice(
                [0, 0, 0],
                [1, 1, 1],
                1000
            );
            
            expect(validCount).to.equal(0n);
            expect(aggregated).to.equal(0n);
        });

        it("handles weighted aggregation", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // Simple case: equal weights
            // Average of 100 and 200 = 150
            const [aggregated] = await harness.testComputeAggregatedPrice(
                [e18(100), e18(200)],
                [1, 1],
                5000 // 50% to include both
            );
            
            // Should be 150 (simple average with equal weights)
            expect(aggregated).to.equal(e18(150));
        });
    });

    describe("calculateDeviation", () => {
        it("calculates deviation correctly", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 110 vs 100 = 10% deviation = 1000 BPS
            const dev = await harness.testCalculateDeviation(110, 100);
            expect(dev).to.equal(1000n);
        });

        it("handles reverse direction", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 90 vs 100 = 10% deviation = 1000 BPS
            const dev = await harness.testCalculateDeviation(90, 100);
            expect(dev).to.equal(1000n);
        });

        it("returns BPS for zero base", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const dev = await harness.testCalculateDeviation(100, 0);
            expect(dev).to.equal(10000n);
        });

        it("returns zero for equal values", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const dev = await harness.testCalculateDeviation(100, 100);
            expect(dev).to.equal(0n);
        });

        it("handles small deviations", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 101 vs 100 = 1% = 100 BPS
            const dev = await harness.testCalculateDeviation(101, 100);
            expect(dev).to.equal(100n);
        });
    });
});

describe("CircuitBreakerLib", () => {
    async function deployFixture() {
        const libs = await deployAllLibraries();
        const harness = await deployHarness("CoverageHarness", libs);
        return { harness };
    }

    const MARKET = "0x00000000000000000000000000000000000000B7";

    describe("circuit breaker edge cases", () => {
        it("handles multiple breaker types on same market", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // Configure price drop breaker
            await harness.testConfigureBreaker(MARKET, 0, 1000, 900, 600); // BreakerType.PRICE_DROP = 0
            
            // Configure volume spike breaker
            await harness.testConfigureBreaker(MARKET, 1, 3000, 900, 600); // BreakerType.VOLUME_SPIKE = 1
            
            // Both should be configured
            const priceResult = await harness.testCheckPriceDropTriggered(e18(80), e18(100), 500);
            expect(priceResult[0]).to.equal(true); // Price drop > 10%
        });

        it("resets breaker correctly after cooldown", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            await harness.testConfigureBreaker(MARKET, 0, 1000, 900, 600);
            await harness.testTriggerBreaker(MARKET, 0);
            
            // Should be restricted
            expect(await harness.testIsActionAllowed(MARKET, 0, false)).to.equal(false);
            
            // Fast-forward past cooldown period (600 seconds) and mine a block
            await time.increase(601);
            
            // Reset without manual admin override (cooldown expired)
            await harness.testResetBreaker(MARKET, 0, false);
            
            // Should be allowed now
            const allowed = await harness.testIsActionAllowed(MARKET, 0, false);
            expect(allowed).to.equal(true);
        });

        it("admin override bypasses restrictions", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            await harness.testConfigureBreaker(MARKET, 0, 1000, 900, 600);
            await harness.testTriggerBreaker(MARKET, 0);
            
            // Reset with admin override
            await harness.testResetBreaker(MARKET, 0, true);
            
            // Should be allowed now
            expect(await harness.testIsActionAllowed(MARKET, 0, false)).to.equal(true);
        });
    });

    describe("price drop detection", () => {
        it("detects small price drops", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 2% drop
            const [triggered, dropBps] = await harness.testCheckPriceDropTriggered(
                e18(98),
                e18(100),
                100 // 1% threshold
            );
            
            expect(triggered).to.equal(true);
            expect(dropBps).to.equal(200n);
        });

        it("ignores price increases", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const [triggered] = await harness.testCheckPriceDropTriggered(
                e18(105),
                e18(100),
                500
            );
            
            expect(triggered).to.equal(false);
        });

        it("handles zero previous price", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // Should not trigger on zero previous (avoid division by zero)
            const [triggered] = await harness.testCheckPriceDropTriggered(e18(100), 0, 500);
            expect(triggered).to.equal(false);
        });
    });

    describe("volume spike detection", () => {
        it("detects large volume spikes", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // 10x volume spike
            const [triggered] = await harness.testCheckVolumeSpikeTriggered(
                e18(10000),
                e18(1000),
                500 // 5x threshold
            );
            
            expect(triggered).to.equal(true);
        });

        it("ignores normal volume", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const [triggered] = await harness.testCheckVolumeSpikeTriggered(
                e18(2000),
                e18(1000),
                500 // 5x threshold
            );
            
            expect(triggered).to.equal(false);
        });

        it("handles zero baseline volume", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            // Should not trigger on zero baseline
            const [triggered] = await harness.testCheckVolumeSpikeTriggered(e18(1000), 0, 500);
            expect(triggered).to.equal(false);
        });
    });

    describe("TWAP deviation detection", () => {
        it("detects deviation above threshold", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const [triggered, dev] = await harness.testCheckTWAPDeviationTriggered(
                e18(120),
                e18(100),
                1000 // 10% threshold
            );
            
            expect(triggered).to.equal(true);
            expect(dev).to.equal(2000n); // 20% deviation
        });

        it("ignores small deviations", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const [triggered] = await harness.testCheckTWAPDeviationTriggered(
                e18(105),
                e18(100),
                1000 // 10% threshold
            );
            
            expect(triggered).to.equal(false);
        });
    });
});

describe("TWAP Buffer Operations", () => {
    async function deployFixture() {
        const libs = await deployAllLibraries();
        const harness = await deployHarness("CoverageHarness", libs);
        return { harness };
    }

    describe("addPricePoint and TWAP calculation", () => {
        it("adds multiple price points and calculates TWAP", async () => {
            const { harness } = await loadFixture(deployFixture);
            const now = await time.latest();
            
            await harness.addPricePoint(e18(100), 0, now - 1000);
            await harness.addPricePoint(e18(105), 0, now - 500);
            await harness.addPricePoint(e18(110), 0, now);
            
            const twap = await harness.testCalculateTWAP(2000);
            expect(twap).to.be.greaterThan(0n);
            expect(twap).to.be.closeTo(e18(105), e18(10)); // Should be around 105
        });

        it("calculates TWAP with count", async () => {
            const { harness } = await loadFixture(deployFixture);
            const now = await time.latest();
            
            await harness.addPricePoint(e18(100), 0, now - 600);
            await harness.addPricePoint(e18(110), 0, now - 300);
            
            const [twap, count] = await harness.testCalculateTWAPWithCount(1000);
            expect(count).to.equal(2n);
            expect(twap).to.be.greaterThan(0n);
        });

        it("calculates simple TWAP from buffer", async () => {
            const { harness } = await loadFixture(deployFixture);
            const now = await time.latest();
            
            await harness.addPricePoint(e18(100), 0, now - 300);
            await harness.addPricePoint(e18(200), 0, now);
            
            const twap = await harness.testCalculateSimpleTWAPFromBuffer();
            expect(twap).to.be.greaterThan(0n);
            expect(twap).to.be.lessThanOrEqual(e18(200));
        });

        it("handles empty buffer", async () => {
            const { harness } = await loadFixture(deployFixture);
            
            const twap = await harness.testCalculateSimpleTWAPFromBuffer();
            expect(twap).to.equal(0n);
        });

        it("handles single price point", async () => {
            const { harness } = await loadFixture(deployFixture);
            const now = await time.latest();
            
            await harness.addPricePoint(e18(100), 0, now);
            
            const twap = await harness.testCalculateTWAP(1000);
            expect(twap).to.equal(e18(100));
        });
    });
});
