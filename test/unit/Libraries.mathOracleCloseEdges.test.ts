import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";

async function fcpm() {
    const libs = await deployAllLibraries();
    return deployHarness("FeeCalculatorPositionMathHarness", libs);
}
async function coverageHarness() {
    const libs = await deployAllLibraries();
    return deployHarness("CoverageHarness", libs);
}

describe("PositionMath — large-size and floor handling", () => {
    it("calculateMaintenanceMargin floors to MIN when bps below the minimum", async () => {
        const h = await loadFixture(fcpm);
        // bps 10 < MIN(100) -> floored to 100
        expect(await h.calcMaintenanceMargin(e18(10_000), 10)).to.equal((e18(10_000) * 100n) / 10_000n);
    });

    it("calculateFundingOwed large-size path (> uint96) with remainder", async () => {
        const h = await loadFixture(fcpm);
        // size above uint96.max (~7.9e28) with a remainder mod 1e18 -> large-size path
        const bigSize = (2n ** 96n) + 123n;
        const owed = await h.calcFundingOwed(bigSize, 1, e18(1) / 1000n);
        expect(owed).to.not.equal(0n);
    });

    it("calculateFundingOwed large-size path with a large delta (> uint96)", async () => {
        const h = await loadFixture(fcpm);
        const bigSize = (2n ** 100n);
        const bigDelta = (2n ** 97n); // > uint96 but < uint128
        const owed = await h.calcFundingOwed(bigSize, 0, bigDelta); // short flips sign
        expect(owed).to.be.lessThan(0n);
    });

    it("calculateFundingOwed reverts when delta exceeds uint128", async () => {
        const h = await loadFixture(fcpm);
        await expect(h.calcFundingOwed(e18(1000), 1, 2n ** 130n)).to.be.reverted; // FundingDeltaTooLarge
    });
});

describe("OracleAggregatorLib — TWAP edge cases", () => {
    it("calculateTWAP breaks on points older than the window and reverts when all are stale", async () => {
        const h = await loadFixture(coverageHarness);
        const now = await time.latest();
        // add a single old point far outside any small window
        await h.addPricePoint(e18(100), 0, now - 100_000);
        // querying a tiny window -> the only point is older than cutoff -> totalWeight 0 -> NoValidPrice
        await expect(h.testCalculateTWAP(10)).to.be.reverted;
    });

    it("calculateTWAP with recent points returns a weighted price", async () => {
        const h = await loadFixture(coverageHarness);
        const now = await time.latest();
        await h.addPricePoint(e18(100), 0, now - 100);
        await h.addPricePoint(e18(102), 0, now - 50);
        const twap = await h.testCalculateTWAP(900);
        expect(twap).to.be.greaterThan(0n);
    });

    it("calculateTWAPWithCount caps a price above uint128.max and counts points", async () => {
        const h = await loadFixture(coverageHarness);
        const now = await time.latest();
        // price stored as uint128; max it out to exercise the price-cap path
        await h.addPricePoint((2n ** 128n) - 1n, 1, now - 10);
        await h.addPricePoint(e18(100), 1, now - 5);
        const [twap, count] = await h.testCalculateTWAPWithCount(900);
        expect(count).to.equal(2n);
        expect(twap).to.be.greaterThan(0n);
    });

    it("calculateTWAPWithCount reverts when all points fall outside the window", async () => {
        const h = await loadFixture(coverageHarness);
        const now = await time.latest();
        await h.addPricePoint(e18(100), 1, now - 100_000);
        await expect(h.testCalculateTWAPWithCount(10)).to.be.reverted;
    });

    it("calculateSimpleTWAP averages buffered prices", async () => {
        const h = await loadFixture(coverageHarness);
        const now = await time.latest();
        await h.addPricePoint(e18(100), 0, now - 10);
        await h.addPricePoint(e18(200), 0, now - 5);
        expect(await h.testCalculateSimpleTWAPFromBuffer()).to.equal(e18(150));
    });

    it("calculateTWAP caps a price above uint128.max within the window", async () => {
        const h = await loadFixture(coverageHarness);
        const now = await time.latest();
        await h.addPricePoint((2n ** 128n) - 1n, 0, now - 10);
        await h.addPricePoint(e18(100), 0, now - 5);
        const twap = await h.testCalculateTWAP(900);
        expect(twap).to.be.greaterThan(0n);
    });

    it("calculateTWAP includes a point exactly at the cutoff (zero time-weight)", async () => {
        const h = await loadFixture(coverageHarness);
        const now = await time.latest();
        // a point right at the cutoff boundary contributes zero time-weight
        await h.addPricePoint(e18(100), 0, now - 900);
        await h.addPricePoint(e18(110), 0, now - 1);
        const twap = await h.testCalculateTWAP(900);
        expect(twap).to.be.greaterThan(0n);
    });
});

describe("PositionCloseLib — bad-debt residual handling", () => {
    async function setup() {
        const [admin, treasury, owner] = await ethers.getSigners();
        const USDC = await ethers.getContractFactory("MockUSDC");
        const usdc = await USDC.deploy();
        await usdc.waitForDeployment();
        const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();
        const PT = await ethers.getContractFactory("MockPositionTokenSimple");
        const pt = await PT.deploy();
        await pt.waitForDeployment();
        const Vault = await ethers.getContractFactory("MockVaultControl");
        const vault = await Vault.deploy();
        await vault.waitForDeployment();
        const libs = await deployAllLibraries();
        const h = await deployHarness("PositionCloseLibHarness", libs, [
            await usdc.getAddress(),
            await vault.getAddress(),
            await oracle.getAddress(),
            await pt.getAddress(),
            treasury.address,
        ]);
        await usdc.mintTo(await h.getAddress(), e6(10_000_000));
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(50_000), 0, now);
        await oracle.setTWAP(MARKET, e18(50_000));
        await oracle.setTWAPValid(MARKET, true);
        await h.setMarket(MARKET, 500);
        return { h, usdc, oracle, pt, vault, owner };
    }

    it("partial insurance cover on an underwater close (covered>0 but < shortfall)", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(setup);
        await vault.setCoverAmount(e6(3_000)); // partial cover
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(300), e18(9_500));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(40_000), 0, now); // -20% deep loss
        await oracle.setTWAP(MARKET, e18(40_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });

    it("zero insurance cover on an underwater close scales receiveAmount down", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(setup);
        await vault.setCoverAmount(0); // no cover
        await h.setPosition(1, MARKET, e18(10_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(300), e18(9_500));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(40_000), 0, now);
        await oracle.setTWAP(MARKET, e18(40_000));
        await h.close(1, e18(10_000), 0);
        expect((await h.positions(1)).state).to.equal(PosStatus.CLOSED);
    });
});

describe("CollateralRouterLib — single-token skip cases", () => {
    async function setup() {
        const [admin, user] = await ethers.getSigners();
        const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();
        const Registry = await ethers.getContractFactory("CollateralRegistry");
        const registry = await Registry.deploy(admin.address, await oracle.getAddress());
        await registry.waitForDeployment();
        const Token = await ethers.getContractFactory("MockUSDC");
        const t1 = await Token.deploy();
        await t1.waitForDeployment();
        const a1 = await t1.getAddress();
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(a1, e18(1), 0, now);
        await registry.registerToken(a1, 200, 500, 3000, 100, 50, e6(100_000_000), a1, 6);
        const libs = await deployAllLibraries();
        const h = await deployHarness("ExtraCoverageHarness", libs);
        return { h, registry, t1, a1, user };
    }

    it("selectBestCollateral skips a token with zero balance", async () => {
        const { h, registry, a1, user } = await loadFixture(setup);
        const [token] = await h.selectBestCollateral(user.address, [a1], await registry.getAddress(), e6(100), false);
        expect(token).to.equal(ethers.ZeroAddress); // zero balance -> no selection
    });

    it("basket skips a zero-balance token and returns empty", async () => {
        const { h, registry, a1, user } = await loadFixture(setup);
        const [total, count] = await h.selectBestCollateralBasket(
            user.address,
            [a1],
            await registry.getAddress(),
            e6(100),
            false,
        );
        expect(count).to.equal(0n);
        expect(total).to.equal(0n);
    });
});

describe("FeeCalculator zero-size & WithdrawLib zero-balance no-ops", () => {
    it("calculateTradingFee returns 0 for zero size", async () => {
        const h = await loadFixture(fcpm);
        expect(await h.calcTradingFee(0, 2, 10, 0, false, 0)).to.equal(0n);
    });

    it("withdrawOrderCollateralRefund is a no-op for a zero balance", async () => {
        const h = await loadFixture(coverageHarness);
        const M = await ethers.getContractFactory("MockUSDC");
        const usdc = await M.deploy();
        await usdc.waitForDeployment();
        const [a] = await ethers.getSigners();
        // no balance set -> early return, no transfer
        await h.testWithdrawOrderCollateralRefund(a.address, await usdc.getAddress());
    });
});
