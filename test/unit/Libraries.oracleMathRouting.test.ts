import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

describe("OracleAggregatorLib — edge cases", () => {
    it("normalizeChainlinkPrice: answer <= 0 returns 0", async () => {
        const h = await loadFixture(coverageHarness);
        expect(await h.testNormalizeChainlinkPrice(0, 8)).to.equal(0n);
        expect(await h.testNormalizeChainlinkPrice(-5, 8)).to.equal(0n);
    });
    it("normalizeChainlinkPrice: decimals == 18 passthrough", async () => {
        const h = await loadFixture(coverageHarness);
        expect(await h.testNormalizeChainlinkPrice(e18(123), 18)).to.equal(e18(123));
    });
    it("normalizeChainlinkPrice: decimals > 18 divides down", async () => {
        const h = await loadFixture(coverageHarness);
        // 20-decimal answer of 123e20 -> 123e18
        expect(await h.testNormalizeChainlinkPrice(123n * 10n ** 20n, 20)).to.equal(e18(123));
    });
    it("normalizeChainlinkPrice: decimals < 18 scales up", async () => {
        const h = await loadFixture(coverageHarness);
        expect(await h.testNormalizeChainlinkPrice(123n * 10n ** 8n, 8)).to.equal(e18(123));
    });
    it("calculateSimpleTWAP returns 0 for an empty buffer", async () => {
        const h = await loadFixture(coverageHarness);
        expect(await h.testCalculateSimpleTWAPFromBuffer()).to.equal(0n);
    });
    it("checkTWAPDeviationTriggered returns (false,0) when twap is zero", async () => {
        const h = await loadFixture(coverageHarness);
        const [triggered, dev] = await h.testCheckTWAPDeviationTriggered(e18(100), 0, 500);
        expect(triggered).to.equal(false);
        expect(dev).to.equal(0n);
    });
    it("checkTWAPDeviationTriggered: current below twap path", async () => {
        const h = await loadFixture(coverageHarness);
        const [triggered, dev] = await h.testCheckTWAPDeviationTriggered(e18(80), e18(100), 1000);
        expect(triggered).to.equal(true);
        expect(dev).to.equal(2000n);
    });
    it("computeAggregatedPrice filters when an outlier skews the mean beyond max deviation", async () => {
        const h = await loadFixture(coverageHarness);
        // 100,100,100 + 1000 outlier -> mean 325; every entry deviates > 5% so all filtered
        const [agg, valid] = await h.testComputeAggregatedPrice(
            [e18(100), e18(100), e18(100), e18(1000)],
            [1, 1, 1, 1],
            500,
        );
        expect(valid).to.equal(0n);
        expect(agg).to.equal(0n);
    });
    it("computeAggregatedPrice includes a tight cluster within deviation", async () => {
        const h = await loadFixture(coverageHarness);
        const [agg, valid] = await h.testComputeAggregatedPrice(
            [e18(100), e18(101), e18(99), e18(102)],
            [1, 1, 1, 1],
            500,
        );
        expect(valid).to.equal(4n);
        expect(agg).to.be.greaterThan(0n);
    });
});

describe("PositionMath trailing-stop & anchor (short side)", () => {
    async function extra() {
        const libs = await deployAllLibraries();
        return deployHarness("ExtraCoverageHarness", libs);
    }
    it("updateTrailingAnchor short ratchets down and ignores upward moves", async () => {
        const h = await loadFixture(extra);
        expect(await h.updateTrailingAnchor(false, e18(90), e18(100))).to.equal(e18(90));
        expect(await h.updateTrailingAnchor(false, e18(110), e18(100))).to.equal(e18(100));
    });
    it("updateTrailingAnchor long ratchets up and ignores downward moves", async () => {
        const h = await loadFixture(extra);
        expect(await h.updateTrailingAnchor(true, e18(110), e18(100))).to.equal(e18(110));
        expect(await h.updateTrailingAnchor(true, e18(90), e18(100))).to.equal(e18(100));
    });
    it("updateTrailingAnchor returns currentPrice when anchor is zero", async () => {
        const h = await loadFixture(extra);
        expect(await h.updateTrailingAnchor(true, e18(123), 0)).to.equal(e18(123));
    });
    it("shouldTriggerTrailingStop short fires on upward retrace, long on downward", async () => {
        const h = await loadFixture(extra);
        // short: anchor 100, 5% trail -> triggers when price >= 105
        expect(await h.shouldTriggerTrailingStop(false, 500, e18(106), e18(100))).to.equal(true);
        expect(await h.shouldTriggerTrailingStop(false, 500, e18(104), e18(100))).to.equal(false);
        // short price below anchor never triggers
        expect(await h.shouldTriggerTrailingStop(false, 500, e18(99), e18(100))).to.equal(false);
        // long: anchor 100, triggers when price <= 95
        expect(await h.shouldTriggerTrailingStop(true, 500, e18(94), e18(100))).to.equal(true);
        // disabled when bps == 0
        expect(await h.shouldTriggerTrailingStop(true, 0, e18(50), e18(100))).to.equal(false);
        // zero anchor never triggers
        expect(await h.shouldTriggerTrailingStop(true, 500, e18(50), 0)).to.equal(false);
    });
});

describe("CollateralRouterLib — disabled, zero-balance, and split-fill selection", () => {
    async function setup() {
        const [admin, user] = await ethers.getSigners();
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const Registry = await ethers.getContractFactory("CollateralRegistry");
        const registry = await Registry.deploy(admin.address, await oracle.getAddress());
        await registry.waitForDeployment();

        const Token = await ethers.getContractFactory("MockUSDC");
        const t1 = await Token.deploy();
        const t2 = await Token.deploy();
        await t1.waitForDeployment();
        await t2.waitForDeployment();
        const a1 = await t1.getAddress();
        const a2 = await t2.getAddress();

        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(a1, e18(1), 0, now);
        await oracle.setPrice(a2, e18(1), 0, now);
        await registry.registerToken(a1, 200, 500, 3000, 100, 50, ethers.parseUnits("1000000", 6), a1, 6);
        await registry.registerToken(a2, 300, 600, 3000, 100, 50, ethers.parseUnits("500000", 6), a2, 6);

        const libs = await deployAllLibraries();
        const h = await deployHarness("ExtraCoverageHarness", libs);
        return { h, registry, oracle, t1, t2, a1, a2, user, admin };
    }

    const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

    it("skips a disabled token in single-token selection", async () => {
        const { h, registry, t1, t2, a1, a2, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(10_000));
        await t2.mintTo(user.address, e6(10_000));
        await registry.setTokenEnabled(a1, false); // disabled -> skipped
        const [token] = await h.selectBestCollateral(user.address, [a1, a2], await registry.getAddress(), e6(1000), false);
        expect(token).to.equal(a2);
    });

    it("basket: skips disabled and zero-balance tokens then splits across the rest", async () => {
        const { h, registry, t1, t2, a1, a2, user } = await loadFixture(setup);
        // t1 disabled, t2 funded but not enough alone -> basket returns t2 partial
        await t2.mintTo(user.address, e6(5_000));
        await registry.setTokenEnabled(a1, false);
        const [total, count] = await h.selectBestCollateralBasket(
            user.address,
            [a1, a2],
            await registry.getAddress(),
            e6(50_000), // more than balance -> partial fill path
            false,
        );
        expect(count).to.be.greaterThanOrEqual(1n);
        expect(total).to.be.greaterThan(0n);
    });

    it("basket: single token suffices returns one allocation", async () => {
        const { h, registry, t1, a1, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(10_000));
        const [total, count] = await h.selectBestCollateralBasket(
            user.address,
            [a1],
            await registry.getAddress(),
            e6(1000),
            false,
        );
        expect(count).to.equal(1n);
        expect(total).to.be.greaterThan(0n);
    });

    it("getUserTotalCollateralValue skips disabled tokens", async () => {
        const { h, registry, t1, t2, a1, a2, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(10_000));
        await t2.mintTo(user.address, e6(10_000));
        const before = await h.getUserTotalCollateralValue(user.address, [a1, a2], await registry.getAddress(), false);
        await registry.setTokenEnabled(a1, false);
        const after = await h.getUserTotalCollateralValue(user.address, [a1, a2], await registry.getAddress(), false);
        expect(after).to.be.lessThan(before);
    });

    it("selection returns zero token when needed amount exceeds balance after haircut", async () => {
        const { h, registry, t1, a1, user } = await loadFixture(setup);
        // fund just under the required value so balanceUsdcValue < required -> skip
        await t1.mintTo(user.address, e6(50));
        const [token] = await h.selectBestCollateral(user.address, [a1], await registry.getAddress(), e6(1000), false);
        expect(token).to.equal(ethers.ZeroAddress);
    });
});
