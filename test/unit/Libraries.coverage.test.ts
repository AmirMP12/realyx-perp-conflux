import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BreakerType, BreakerState } from "../helpers/constants";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

/**
 * Direct library coverage via the in-repo harnesses. These hit pure/internal
 * library branches that are awkward to reach through the full engine, lifting
 * branch coverage on OracleAggregatorLib, CircuitBreakerLib, RateLimitLib,
 * FundingLib, HealthLib, DividendSettlementLib, and LiquidationLib.
 */
async function deployCoverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

describe("Library coverage — OracleAggregatorLib (via CoverageHarness)", () => {
    it("calculateDeviation is relative to the second argument", async () => {
        const h = await loadFixture(deployCoverageHarness);
        // deviation = |a-b| * BPS / b
        expect(await h.testCalculateDeviation(100, 110)).to.equal(909n); // 10/110
        expect(await h.testCalculateDeviation(110, 100)).to.equal(1000n); // 10/100
    });
    it("calculateDeviation returns BPS when b is zero", async () => {
        const h = await loadFixture(deployCoverageHarness);
        expect(await h.testCalculateDeviation(100, 0)).to.equal(10000n);
    });
    it("normalizeChainlinkPrice scales by decimals", async () => {
        const h = await loadFixture(deployCoverageHarness);
        // answer 100 with 8 decimals -> normalized to 1e18
        expect(await h.testNormalizeChainlinkPrice(100n * 10n ** 8n, 8)).to.equal(e18(100));
    });
    it("checkPriceDropTriggered fires when drop exceeds threshold", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const [triggered, dropBps] = await h.testCheckPriceDropTriggered(e18(90), e18(100), 500);
        expect(triggered).to.equal(true);
        expect(dropBps).to.equal(1000n);
    });
    it("checkPriceDropTriggered false when within threshold", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const [triggered] = await h.testCheckPriceDropTriggered(e18(99), e18(100), 500);
        expect(triggered).to.equal(false);
    });
    it("checkTWAPDeviationTriggered detects deviation", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const [triggered, dev] = await h.testCheckTWAPDeviationTriggered(e18(120), e18(100), 1000);
        expect(triggered).to.equal(true);
        expect(dev).to.be.greaterThan(0n);
    });
    it("checkVolumeSpikeTriggered detects spike", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const [triggered] = await h.testCheckVolumeSpikeTriggered(e18(1000), e18(100), 300);
        expect(triggered).to.equal(true);
    });
    it("computeAggregatedPrice weighted average", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const [agg] = await h.testComputeAggregatedPrice([e18(100), e18(102)], [1, 1], 5000);
        expect(agg).to.be.greaterThan(0n);
    });
    it("calculateWeightedAverage", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const avg = await h.testCalculateWeightedAverage([e18(100), e18(200)], [1, 1]);
        expect(avg).to.equal(e18(150));
    });
    it("TWAP buffer math over added points", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await h.addPricePoint(e18(100), 0, now - 100);
        await h.addPricePoint(e18(102), 0, now - 50);
        await h.addPricePoint(e18(104), 0, now - 10);
        const twap = await h.testCalculateTWAP(900);
        expect(twap).to.be.greaterThan(0n);
        const [twap2, count] = await h.testCalculateTWAPWithCount(900);
        expect(count).to.be.greaterThan(0n);
        const simple = await h.testCalculateSimpleTWAPFromBuffer();
        expect(simple).to.be.greaterThan(0n);
    });
});

describe("Library coverage — CircuitBreakerLib (via CoverageHarness)", () => {
    const MARKET = "0x00000000000000000000000000000000000000B7";
    it("configure + trigger + reset cycle", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600);
        await h.testTriggerBreaker(MARKET, BreakerType.PRICE_DROP);
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(false);
        await h.testResetBreaker(MARKET, BreakerType.PRICE_DROP, true);
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(true);
    });
    it("isActionAllowed false under global pause", async () => {
        const h = await loadFixture(deployCoverageHarness);
        expect(await h.testIsActionAllowed(MARKET, 0, true)).to.equal(false);
    });
    it("checkPriceDropBreaker triggers and persists", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
        await h.testCheckPriceDropBreaker(MARKET, e18(90), e18(100));
        // after a >5% drop the breaker should restrict actions
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(false);
    });
    it("checkTWAPDeviationBreaker evaluates deviation", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.TWAP_DEVIATION, 500, 900, 600);
        await h.testCheckTWAPDeviationBreaker(MARKET, e18(120), e18(100));
    });
});

describe("Library coverage — RateLimitLib (via CoverageHarness)", () => {
    it("allows small actions and updates the bucket", async () => {
        const h = await loadFixture(deployCoverageHarness);
        // size below threshold -> no revert
        await h.testRateLimit(e18(1), e18(1000), 300);
    });
    it("reverts when large actions exceed the rate", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.testRateLimit(e18(5000), e18(1000), 300); // first large action consumes budget
        await expect(h.testRateLimit(e18(5000), e18(1000), 300)).to.be.reverted;
    });
});

describe("Library coverage — TradingLib helpers (via CoverageHarness)", () => {
    it("checkVolumeLimit enforces user/global caps", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const [a] = await ethers.getSigners();
        expect(await h.testCheckVolumeLimit(a.address, e18(100), e18(1000), e18(10000))).to.equal(true);
        await h.testUpdateVolume(a.address, e18(900));
        expect(await h.testCheckVolumeLimit(a.address, e18(200), e18(1000), e18(10000))).to.equal(false);
    });
    it("calculateNewLeverage handles zero collateral", async () => {
        const h = await loadFixture(deployCoverageHarness);
        expect(await h.testCalculateNewLeverage(e18(1000), 0)).to.equal(ethers.MaxUint256);
        expect(await h.testCalculateNewLeverage(e18(1000), e18(100))).to.equal(e18(10));
    });
    it("getUserPositionsPaginated + getActivePositions", async () => {
        const h = await loadFixture(deployCoverageHarness);
        await h.addPositionId(1);
        await h.addPositionId(2);
        await h.addPositionId(3);
        const [ids, total] = await h.testGetUserPositionsPaginated(0, 2);
        expect(total).to.equal(3n);
        expect(ids.length).to.equal(2);
        // out-of-range offset returns empty
        const [empty] = await h.testGetUserPositionsPaginated(10, 2);
        expect(empty.length).to.equal(0);
    });
    it("settleFunding via harness advances state", async () => {
        const h = await loadFixture(deployCoverageHarness);
        const MARKET = "0x00000000000000000000000000000000000000B7";
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await h.setFundingState(MARKET, 0, 0, now - 9 * 60 * 60, e18(1000), e18(500));
        await h.setMarketExposure(MARKET, true, e18(1000), e18(1000), e18(500), e18(500));
        await h.testTradingLibSettleFunding(MARKET);
    });
});

describe("Library coverage — FundingLib (dedicated harness)", () => {
    async function deploy() {
        const libs = await deployAllLibraries();
        return deployHarness("FundingLibHarness", libs);
    }
    it("positive funding deducts from collateral", async () => {
        const h = await loadFixture(deploy);
        await h.setCollateral(e18(100));
        await h.applyFunding(e18(30), 1);
        expect(await h.collateralAmount()).to.equal(e18(70));
    });
    it("funding shortfall zeros collateral when funding exceeds it", async () => {
        const h = await loadFixture(deploy);
        await h.setCollateral(e18(10));
        const [, shortfall] = await h.applyFunding.staticCall(e18(30), 1);
        expect(shortfall).to.equal(e18(20));
        await h.applyFunding(e18(30), 1);
        expect(await h.collateralAmount()).to.equal(0n);
    });
    it("negative funding credits collateral", async () => {
        const h = await loadFixture(deploy);
        await h.setCollateral(e18(100));
        await h.applyFunding(-e18(20), 1);
        expect(await h.collateralAmount()).to.equal(e18(120));
    });
    it("zero funding is a no-op", async () => {
        const h = await loadFixture(deploy);
        await h.setCollateral(e18(100));
        await h.applyFunding(0, 1);
        expect(await h.collateralAmount()).to.equal(e18(100));
    });
});

describe("Library coverage — HealthLib (dedicated harness)", () => {
    async function deploy() {
        const libs = await deployAllLibraries();
        return deployHarness("HealthLibHarness", libs);
    }
    it("healthy when bad debt within ratio of TVL", async () => {
        const h = await loadFixture(deploy);
        await h.setBadDebt(e18(100));
        await h.update(e18(1_000_000));
        const [healthy] = await h.getState();
        expect(healthy).to.equal(true);
    });
    it("unhealthy when bad debt exceeds the max ratio", async () => {
        const h = await loadFixture(deploy);
        await h.setBadDebt(e18(900_000));
        await h.update(e18(1_000_000));
        const [healthy] = await h.getState();
        expect(healthy).to.equal(false);
    });
    it("healthy when TVL is zero (no assets, no risk)", async () => {
        const h = await loadFixture(deploy);
        await h.setBadDebt(0);
        await h.update(0);
        const [healthy] = await h.getState();
        expect(healthy).to.equal(true);
    });
});

describe("Library coverage — DividendSettlementLib (dedicated harness)", () => {
    async function deploy() {
        const Mgr = await ethers.getContractFactory("MockDividendManagerForSettlement");
        const mgr = await Mgr.deploy();
        await mgr.waitForDeployment();
        const libs = await deployAllLibraries();
        const h = await deployHarness("DividendSettlementHarness", libs);
        return { h, mgr };
    }
    it("settles a positive dividend for a long", async () => {
        const { h, mgr } = await loadFixture(deploy);
        await h.setPosition(e18(1000), 1); // long
        await mgr.configure(e18(50), 5, false);
        const [amt, idx] = await h.settle.staticCall(1, "AAPL", 0, await mgr.getAddress());
        expect(amt).to.equal(e18(50));
        expect(idx).to.equal(5n);
    });
    it("propagates a reverting manager (no swallow)", async () => {
        const { h, mgr } = await loadFixture(deploy);
        await h.setPosition(e18(1000), 1);
        await mgr.configure(0, 0, true);
        // DividendSettlementLib forwards the manager call; a revert propagates.
        await expect(h.settle.staticCall(1, "AAPL", 0, await mgr.getAddress())).to.be.reverted;
    });
    it("returns zeros when marketId is empty (early return branch)", async () => {
        const { h, mgr } = await loadFixture(deploy);
        await h.setPosition(e18(1000), 1);
        await mgr.configure(e18(50), 5, false);
        const [amt, idx] = await h.settle.staticCall(1, "", 7, await mgr.getAddress());
        expect(amt).to.equal(0n);
        expect(idx).to.equal(7n);
    });
});

describe("Library coverage — LiquidationLib (dedicated harness)", () => {
    async function deploy() {
        const libs = await deployAllLibraries();
        return deployHarness("LiquidationLibHarness", libs);
    }
    const MARKET = "0x00000000000000000000000000000000000000B7";
    it("canLiquidate true for an underwater long", async () => {
        const h = await loadFixture(deploy);
        // size 10000, entry 100, leverage 20x, small collateral
        await h.setPosition(1, 1 /*OPEN*/, MARKET, e18(10_000), e18(100), 1 /*long*/, 20);
        await h.setCollateral(1, e18(200));
        const [liq] = await h.canLiquidateAt(1, e18(85)); // -15%
        expect(liq).to.equal(true);
    });
    it("canLiquidate false for a healthy long", async () => {
        const h = await loadFixture(deploy);
        await h.setPosition(1, 1, MARKET, e18(10_000), e18(100), 1, 5);
        await h.setCollateral(1, e18(5_000));
        const [liq] = await h.canLiquidateAt(1, e18(100));
        expect(liq).to.equal(false);
    });
});
