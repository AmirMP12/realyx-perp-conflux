import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function setup() {
    const Mock = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Mock.deploy();
    await oracle.waitForDeployment();
    const libs = await deployAllLibraries();
    const h = await deployHarness("ExtraCoverageHarness", libs);
    const [, owner] = await ethers.getSigners();
    const market = "0x00000000000000000000000000000000000000B7";
    await oracle.setPrice(market, e18(100), 0, (await ethers.provider.getBlock("latest"))!.timestamp);
    return { h, oracle, owner, market };
}

describe("PortfolioRiskLib", () => {
    // When a cross-margin position has zero stored leverage and the config
    // supplies a non-zero maintenanceMarginBps, the flat-config fallback uses
    // the configured bps rather than the 500 default.
    it("zero-leverage position with non-zero mmBps uses the configured bps", async () => {
        const { h, oracle, owner, market } = await loadFixture(setup);
        await h.setPosition(owner.address, 1, e18(10_000), e18(100), 3, PosStatus.OPEN, market);
        await h.setCollateral(1, e18(5_000));
        await h.setPositionLeverage(1, 0); // force the flat-config fallback path
        // mmBps = 800 (non-zero) -> hits `uint256(cfgBps)` side of the ternary.
        const snap = await h.getAccountRisk(owner.address, await oracle.getAddress(), true, 800, 4000, 20);
        expect(snap.crossPositionCount).to.equal(1n);
        // maintenanceMarginRequirement = size * 800 / 10000 = 10_000 * 0.08 = 800
        expect(snap.maintenanceMarginRequirement).to.equal(e18(800));
    });

    // L89: `if (snapshot.totalNotional > 0 && cfg.concentrationLimitBps > 0)`
    // — the TRUE side: both operands non-zero so the concentration block runs.
    // Here concentration stays UNDER the limit, so it falls through to the
    // final liquidatable check and returns true.
    it("validateOpenPosition enters the concentration block and passes when under limit", async () => {
        const { h } = await loadFixture(setup);
        const snap = {
            totalNotional: e18(1000),
            totalCollateral: e18(1000),
            maintenanceMarginRequirement: e18(50), // concentration = 50*10000/1000 = 500 bps
            unrealizedPnL: 0n,
            healthFactor: e18(2),
            crossPositionCount: 1n,
            liquidatable: false,
        };
        // concentrationLimitBps = 4000 > 0, totalNotional > 0 -> enters block,
        // 500 <= 4000 -> not rejected -> returns !liquidatable = true.
        expect(await h.validateOpenPosition(snap, true, 500, 4000, 20)).to.equal(true);
    });

    // L89 true side again, this time the concentration exceeds the limit so the
    // block returns false. Distinct config from existing tests.
    it("validateOpenPosition rejects when concentration exceeds the limit", async () => {
        const { h } = await loadFixture(setup);
        const snap = {
            totalNotional: e18(2000),
            totalCollateral: e18(2000),
            maintenanceMarginRequirement: e18(600), // concentration = 600*10000/2000 = 3000 bps
            unrealizedPnL: 0n,
            healthFactor: e18(2),
            crossPositionCount: 2n,
            liquidatable: false,
        };
        // concentrationLimitBps = 1000 -> 3000 > 1000 -> rejected.
        expect(await h.validateOpenPosition(snap, true, 500, 1000, 20)).to.equal(false);
    });
});
