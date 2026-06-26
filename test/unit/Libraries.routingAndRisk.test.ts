import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const usdc6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

async function extraHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("ExtraCoverageHarness", libs);
}

/** A collateral registry + token + oracle harness for router tests. */
async function routerSetup() {
    const [admin, user, operator, core] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Mock.deploy();
    await oracle.waitForDeployment();

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    const registry = await CollateralRegistry.deploy(admin.address, await oracle.getAddress());
    await registry.waitForDeployment();

    const Token = await ethers.getContractFactory("MockUSDC"); // generic 6-dp ERC20 with mintTo
    const tokenA = await Token.deploy();
    await tokenA.waitForDeployment();

    // register tokenA with an 18-dp decimals config? MockUSDC is 6 decimals.
    const feed = "0x00000000000000000000000000000000000000F1";
    await oracle.setPrice(feed, e18(1), 0, (await ethers.provider.getBlock("latest"))!.timestamp);
    await registry.registerToken(await tokenA.getAddress(), 200, 500, 3000, 0, 0, 0, feed, 6);

    const h = await extraHarness();
    return { h, registry, oracle, tokenA, admin, user };
}

describe("CollateralRouterLib", () => {
    it("selects the only viable single token", async () => {
        const { h, registry, tokenA, user } = await loadFixture(routerSetup);
        await tokenA.mintTo(user.address, usdc6(1000));
        const [token, amt, val] = await h.selectBestCollateral(
            user.address,
            [await tokenA.getAddress()],
            await registry.getAddress(),
            usdc6(100),
            false,
        );
        expect(token).to.equal(await tokenA.getAddress());
        expect(amt).to.be.greaterThan(0n);
        expect(val).to.be.greaterThan(0n);
    });

    it("returns zero token when balance insufficient", async () => {
        const { h, registry, tokenA, user } = await loadFixture(routerSetup);
        await tokenA.mintTo(user.address, usdc6(10));
        const [token] = await h.selectBestCollateral(
            user.address,
            [await tokenA.getAddress()],
            await registry.getAddress(),
            usdc6(100_000),
            false,
        );
        expect(token).to.equal(ethers.ZeroAddress);
    });

    it("skips tokens with zero balance", async () => {
        const { h, registry, tokenA, user } = await loadFixture(routerSetup);
        const [token] = await h.selectBestCollateral(
            user.address,
            [await tokenA.getAddress()],
            await registry.getAddress(),
            usdc6(100),
            false,
        );
        expect(token).to.equal(ethers.ZeroAddress);
    });

    it("basket selection returns a single-token fill when one suffices", async () => {
        const { h, registry, tokenA, user } = await loadFixture(routerSetup);
        await tokenA.mintTo(user.address, usdc6(1000));
        const [total, count] = await h.selectBestCollateralBasket(
            user.address,
            [await tokenA.getAddress()],
            await registry.getAddress(),
            usdc6(100),
            false,
        );
        expect(total).to.be.greaterThan(0n);
        expect(count).to.equal(1n);
    });

    it("getUserTotalCollateralValue sums balances", async () => {
        const { h, registry, tokenA, user } = await loadFixture(routerSetup);
        await tokenA.mintTo(user.address, usdc6(1000));
        const total = await h.getUserTotalCollateralValue(
            user.address,
            [await tokenA.getAddress()],
            await registry.getAddress(),
            false,
        );
        expect(total).to.be.greaterThan(0n);
    });
});

describe("PortfolioRiskLib", () => {
    async function setup() {
        const Mock = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Mock.deploy();
        await oracle.waitForDeployment();
        const h = await extraHarness();
        const [, owner] = await ethers.getSigners();
        const market = "0x00000000000000000000000000000000000000B7";
        await oracle.setPrice(market, e18(100), 0, (await ethers.provider.getBlock("latest"))!.timestamp);
        return { h, oracle, owner, market };
    }

    it("no cross positions -> max health, not liquidatable", async () => {
        const { h, oracle, owner } = await loadFixture(setup);
        const snap = await h.getAccountRisk(owner.address, await oracle.getAddress(), true, 500, 4000, 20);
        expect(snap.healthFactor).to.equal(ethers.MaxUint256);
        expect(snap.liquidatable).to.equal(false);
    });

    it("healthy cross position", async () => {
        const { h, oracle, owner, market } = await loadFixture(setup);
        // cross-margin long (flags=3), well collateralized
        await h.setPosition(owner.address, 1, e18(10_000), e18(100), 3, PosStatus.OPEN, market);
        await h.setCollateral(1, e18(5_000));
        const snap = await h.getAccountRisk(owner.address, await oracle.getAddress(), true, 500, 4000, 20);
        expect(snap.crossPositionCount).to.equal(1n);
        expect(snap.liquidatable).to.equal(false);
    });

    it("underwater cross position is liquidatable", async () => {
        const { h, oracle, owner, market } = await loadFixture(setup);
        await h.setPosition(owner.address, 1, e18(10_000), e18(100), 3, PosStatus.OPEN, market);
        await h.setCollateral(1, e18(100));
        // crash price for the long
        await oracle.setPrice(market, e18(80), 0, (await ethers.provider.getBlock("latest"))!.timestamp);
        const snap = await h.getAccountRisk(owner.address, await oracle.getAddress(), true, 500, 4000, 20);
        expect(snap.liquidatable).to.equal(true);
    });

    it("validateOpenPosition true when disabled", async () => {
        const { h } = await loadFixture(setup);
        const snap = {
            totalNotional: 0n,
            totalCollateral: 0n,
            maintenanceMarginRequirement: 0n,
            unrealizedPnL: 0n,
            healthFactor: 0n,
            crossPositionCount: 0n,
            liquidatable: false,
        };
        expect(await h.validateOpenPosition(snap, false, 500, 4000, 20)).to.equal(true);
    });

    it("validateOpenPosition false when too many cross positions", async () => {
        const { h } = await loadFixture(setup);
        const snap = {
            totalNotional: e18(1000),
            totalCollateral: e18(1000),
            maintenanceMarginRequirement: e18(50),
            unrealizedPnL: 0n,
            healthFactor: e18(2),
            crossPositionCount: 25n,
            liquidatable: false,
        };
        expect(await h.validateOpenPosition(snap, true, 500, 4000, 20)).to.equal(false);
    });

    it("validateOpenPosition false when concentration exceeds limit", async () => {
        const { h } = await loadFixture(setup);
        const snap = {
            totalNotional: e18(1000),
            totalCollateral: e18(1000),
            maintenanceMarginRequirement: e18(900), // 90% concentration
            unrealizedPnL: 0n,
            healthFactor: e18(2),
            crossPositionCount: 1n,
            liquidatable: false,
        };
        expect(await h.validateOpenPosition(snap, true, 500, 4000, 5)).to.equal(false);
    });
});

describe("RateLimitLib (checkOnly / checkAndUpdateFor)", () => {
    it("checkOnly does not consume budget", async () => {
        const h = await loadFixture(extraHarness);
        const [, actor] = await ethers.getSigners();
        await h.checkOnly(actor.address, e18(5000), e18(1000), 300); // large but no prior action -> ok
        expect(await h.lastLargeActionTime(actor.address)).to.equal(0n);
    });
    it("checkOnly reverts when within interval after a recorded action", async () => {
        const h = await loadFixture(extraHarness);
        const [, actor] = await ethers.getSigners();
        await h.checkAndUpdateFor(actor.address, e18(5000), e18(1000), 300);
        await expect(h.checkOnly(actor.address, e18(5000), e18(1000), 300)).to.be.reverted;
    });
    it("checkAndUpdateFor stamps the actor on a large action", async () => {
        const h = await loadFixture(extraHarness);
        const [, actor] = await ethers.getSigners();
        await h.checkAndUpdateFor(actor.address, e18(5000), e18(1000), 300);
        expect(await h.lastLargeActionTime(actor.address)).to.be.greaterThan(0n);
    });
    it("small actions never stamp or revert", async () => {
        const h = await loadFixture(extraHarness);
        const [, actor] = await ethers.getSigners();
        await h.checkAndUpdateFor(actor.address, e18(10), e18(1000), 300);
        expect(await h.lastLargeActionTime(actor.address)).to.equal(0n);
    });
});

describe("PositionMath trailing/anchor + helpers", () => {
    it("updateTrailingAnchor ratchets for longs and shorts", async () => {
        const h = await loadFixture(extraHarness);
        // long: anchor moves up with price
        expect(await h.updateTrailingAnchor(true, e18(110), e18(100))).to.equal(e18(110));
        expect(await h.updateTrailingAnchor(true, e18(90), e18(100))).to.equal(e18(100));
        // short: anchor moves down with price
        expect(await h.updateTrailingAnchor(false, e18(90), e18(100))).to.equal(e18(90));
        expect(await h.updateTrailingAnchor(false, e18(110), e18(100))).to.equal(e18(100));
        // zero anchor returns current
        expect(await h.updateTrailingAnchor(true, e18(123), 0)).to.equal(e18(123));
    });

    it("shouldTriggerTrailingStop fires on sufficient retrace", async () => {
        const h = await loadFixture(extraHarness);
        // long, anchor 100, 5% trail -> trigger when price <= 95
        expect(await h.shouldTriggerTrailingStop(true, 500, e18(94), e18(100))).to.equal(true);
        expect(await h.shouldTriggerTrailingStop(true, 500, e18(96), e18(100))).to.equal(false);
        // disabled when bps 0
        expect(await h.shouldTriggerTrailingStop(true, 0, e18(50), e18(100))).to.equal(false);
        // short: anchor 100, trigger when price >= 105
        expect(await h.shouldTriggerTrailingStop(false, 500, e18(106), e18(100))).to.equal(true);
        expect(await h.shouldTriggerTrailingStop(false, 500, e18(104), e18(100))).to.equal(false);
        // long price above anchor never triggers
        expect(await h.shouldTriggerTrailingStop(true, 500, e18(101), e18(100))).to.equal(false);
    });

    it("calculateLiquidationFee tiers", async () => {
        const h = await loadFixture(extraHarness);
        expect(await h.calculateLiquidationFeeTiered(e18(1000), e18(1))).to.be.greaterThan(0n); // near
        expect(await h.calculateLiquidationFeeTiered(e18(1000), 6n * 10n ** 17n)).to.be.greaterThan(0n); // medium
        expect(await h.calculateLiquidationFeeTiered(e18(1000), 3n * 10n ** 17n)).to.be.greaterThan(0n); // deep
    });

    it("abs handles int256 min and sign", async () => {
        const h = await loadFixture(extraHarness);
        expect(await h.absInt(-5)).to.equal(5n);
        expect(await h.absInt(5)).to.equal(5n);
        const intMin = -(2n ** 255n);
        expect(await h.absInt(intMin)).to.equal(2n ** 255n);
    });

    it("min / max", async () => {
        const h = await loadFixture(extraHarness);
        expect(await h.maxU(3, 7)).to.equal(7n);
        expect(await h.minU(3, 7)).to.equal(3n);
    });
});
