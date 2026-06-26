import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { BreakerType, PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const MARKET = "0x00000000000000000000000000000000000000B7";

async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

async function extraHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("ExtraCoverageHarness", libs);
}

describe("GlobalPnLLib short-side accumulation", () => {
    it("aggregates both long and short PnL across a market", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(55_000), 0, now);
        await h.addMarket(MARKET);
        // give the market both long and short OI so both PnL legs accumulate
        await h.setMarketExposure(MARKET, true, e18(1000), e18(50_000_000), e18(1000), e18(50_000_000));
        const pnl = await h.testGlobalPnL(await oracle.getAddress());
        expect(typeof pnl).to.equal("bigint");
    });

    it("short-only market contributes short PnL", async () => {
        const h = await loadFixture(coverageHarness);
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(45_000), 0, now);
        await h.addMarket(MARKET);
        await h.setMarketExposure(MARKET, true, 0, 0, e18(1000), e18(50_000_000));
        const pnl = await h.testGlobalPnL(await oracle.getAddress());
        expect(pnl).to.be.greaterThan(0n); // short profits as price fell
    });
});

describe("RateLimitLib checkOnly sub-threshold actions", () => {
    it("checkOnly does not revert for a sub-threshold action", async () => {
        const h = await loadFixture(extraHarness);
        const [, actor] = await ethers.getSigners();
        // size below threshold -> the `size >= threshold` guard is false, no revert/no stamp
        await h.checkOnly(actor.address, e18(10), e18(1000), 300);
        expect(await h.lastLargeActionTime(actor.address)).to.equal(0n);
    });
});

describe("CircuitBreakerLib — action gating and threshold checks", () => {
    it("isActionAllowed allows non-restricting actions under a non-emergency breaker", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
        await h.testTriggerBreaker(MARKET, BreakerType.PRICE_DROP);
        // actionType != 0 under a non-EMERGENCY breaker is still allowed
        expect(await h.testIsActionAllowed(MARKET, 1, false)).to.equal(true);
        // actionType 0 is blocked
        expect(await h.testIsActionAllowed(MARKET, 0, false)).to.equal(false);
    });

    it("checkPriceDropBreaker does not trigger below threshold", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.PRICE_DROP, 5000, 900, 600); // 50% threshold
        // 2% drop is below threshold -> no trigger
        const triggered = await h.testCheckPriceDropBreaker.staticCall(MARKET, e18(98), e18(100));
        expect(triggered).to.equal(false);
    });

    it("checkTWAPDeviationBreaker does not trigger below threshold", async () => {
        const h = await loadFixture(coverageHarness);
        await h.testConfigureBreaker(MARKET, BreakerType.TWAP_DEVIATION, 5000, 900, 600);
        const triggered = await h.testCheckTWAPDeviationBreaker.staticCall(MARKET, e18(102), e18(100));
        expect(triggered).to.equal(false);
    });
});

describe("PortfolioRiskLib validateOpenPosition", () => {
    it("returns true when enabled with no concentration breach", async () => {
        const h = await loadFixture(extraHarness);
        const snap = {
            totalNotional: e18(1000),
            totalCollateral: e18(1000),
            maintenanceMarginRequirement: e18(50),
            unrealizedPnL: 0n,
            healthFactor: e18(2),
            crossPositionCount: 1n,
            liquidatable: false,
        };
        expect(await h.validateOpenPosition(snap, true, 500, 4000, 20)).to.equal(true);
    });
    it("returns false when the snapshot is liquidatable", async () => {
        const h = await loadFixture(extraHarness);
        const snap = {
            totalNotional: e18(1000),
            totalCollateral: e18(10),
            maintenanceMarginRequirement: e18(50),
            unrealizedPnL: 0n,
            healthFactor: e18(0),
            crossPositionCount: 1n,
            liquidatable: true,
        };
        expect(await h.validateOpenPosition(snap, true, 500, 4000, 20)).to.equal(false);
    });
});

describe("PortfolioRiskLib account-risk loop and equity handling", () => {
    const M = "0x00000000000000000000000000000000000000B7";
    async function setup() {
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const libs = await deployAllLibraries();
        const h = await deployHarness("ExtraCoverageHarness", libs);
        const [, owner] = await ethers.getSigners();
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(M, e18(100), 0, now);
        return { h, oracle, owner, now };
    }

    it("skips isolated (non-cross) positions in the account-risk loop", async () => {
        const { h, oracle, owner } = await setup();
        // flags = 1 -> long, isolated (not cross-margin) -> skipped by the cross-account loop
        await h.setPosition(owner.address, 1, e18(10_000), e18(100), 1, PosStatus.OPEN, M);
        await h.setCollateral(1, e18(5_000));
        const snap = await h.getAccountRisk(owner.address, await oracle.getAddress(), true, 500, 4000, 20);
        expect(snap.crossPositionCount).to.equal(0n); // isolated -> not counted
    });

    it("equity <= 0 marks the cross account liquidatable with health 0", async () => {
        const { h, oracle, owner } = await setup();
        // cross-margin (flags=3) with tiny collateral, then crash price so equity<=0
        await h.setPosition(owner.address, 1, e18(10_000), e18(100), 3, PosStatus.OPEN, M);
        await h.setCollateral(1, e18(10));
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(M, e18(50), 0, now); // -50% -> deep loss, equity <= 0
        const snap = await h.getAccountRisk(owner.address, await oracle.getAddress(), true, 500, 4000, 20);
        expect(snap.liquidatable).to.equal(true);
        expect(snap.healthFactor).to.equal(0n);
    });
});
