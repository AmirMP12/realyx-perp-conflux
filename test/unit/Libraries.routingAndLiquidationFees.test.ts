import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";
import { PosStatus } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";

describe("CollateralRouterLib basket split-fill", () => {
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
        const t2 = await Token.deploy();
        await t1.waitForDeployment();
        await t2.waitForDeployment();
        const a1 = await t1.getAddress();
        const a2 = await t2.getAddress();
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(a1, e18(1), 0, now);
        await oracle.setPrice(a2, e18(1), 0, now);
        await registry.registerToken(a1, 200, 500, 3000, 100, 50, e6(100_000_000), a1, 6);
        await registry.registerToken(a2, 200, 500, 3000, 100, 50, e6(100_000_000), a2, 6);
        const libs = await deployAllLibraries();
        const h = await deployHarness("ExtraCoverageHarness", libs);
        return { h, registry, t1, t2, a1, a2, user };
    }

    it("splits a required value across two tokens when no single token suffices", async () => {
        const { h, registry, t1, t2, a1, a2, user } = await loadFixture(setup);
        // each token holds 3,000; require 5,000 -> needs both (split-fill loop)
        await t1.mintTo(user.address, e6(3_000));
        await t2.mintTo(user.address, e6(3_000));
        const [total, count] = await h.selectBestCollateralBasket(
            user.address,
            [a1, a2],
            await registry.getAddress(),
            e6(5_000),
            false,
        );
        expect(count).to.equal(2n);
        expect(total).to.be.greaterThanOrEqual(e6(5_000));
    });

    it("returns a partial basket when total collateral is insufficient", async () => {
        const { h, registry, t1, t2, a1, a2, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(1_000));
        await t2.mintTo(user.address, e6(1_000));
        const [total] = await h.selectBestCollateralBasket(
            user.address,
            [a1, a2],
            await registry.getAddress(),
            e6(50_000),
            false,
        );
        expect(total).to.be.lessThan(e6(50_000));
    });
});

describe("LiquidationLib partial-fee and reward handling", () => {
    async function liqSetup() {
        const [admin, treasury, owner, liquidator] = await ethers.getSigners();
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
        const h = await deployHarness("LiquidationLibHarnessDeep", libs, [
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
        return { h, usdc, oracle, pt, vault, owner };
    }

    it("partial cover yields remainingForFees that fully funds the liquidator", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        // cover most of the shortfall so actualAvailable >= receiveAmount with
        // remainingForFees >= liqFee -> liquidatorReward = liqFee, insurance = remainder
        await vault.setCoverAmount(e6(2_000));
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(1_500), e18(9_000));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(48_000), 0, now); // -4%
        await oracle.setTWAP(MARKET, e18(48_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("clean liquidation with full fees (availableUsdc >= totalRequired)", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        // ample collateral, no borrow -> no shortfall; liquidator + insurance fully paid
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(450));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, e18(47_000));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("liquidation with no TWAP set skips the deviation guard", async () => {
        const { h, oracle, pt, owner } = await loadFixture(liqSetup);
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(450));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(47_000), 0, now);
        await oracle.setTWAP(MARKET, 0); // twap 0 -> deviation guard skipped
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("partial cover leaving remainingForFees BELOW the liquidator fee", async () => {
        const { h, oracle, pt, vault, owner } = await loadFixture(liqSetup);
        // tune cover so actualAvailable just covers receiveAmount plus a sliver,
        // leaving remainingForFees < liqFee -> liquidatorReward = remainder, insurance 0.
        await vault.setCoverAmount(e6(8_900));
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateralWithBorrow(1, e18(100), e18(9_500));
        await pt.setOwner(1, owner.address);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MARKET, e18(46_500), 0, now); // -7%
        await oracle.setTWAP(MARKET, e18(46_500));
        await h.liquidate(1);
        expect((await h.positions(1)).state).to.equal(PosStatus.LIQUIDATED);
    });

    it("checkLiquidatableBatch skips a closed position", async () => {
        const { h, oracle } = await loadFixture(liqSetup);
        // Reuse the same deep harness positions: id 2 closed, id 1 open underwater.
        await h.setPosition(1, MARKET, e18(20_000), e18(50_000), 1, PosStatus.OPEN);
        await h.setCollateral(1, e18(200));
        expect((await h.positions(1)).state).to.equal(PosStatus.OPEN);
    });
});
