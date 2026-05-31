import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { OPERATOR_ROLE, TRADING_CORE_ROLE } from "../helpers/constants";

/**
 * CollateralRegistry is a plain AccessControl contract. We pair it with a
 * simple mock oracle (MockOracleConfigurable exposes getPrice) so valuation
 * branches can be exercised deterministically.
 */
async function deploy() {
    const [admin, operator, core, other] = await ethers.getSigners();

    const MockOracle = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await MockOracle.deploy();
    await oracle.waitForDeployment();

    const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
    const cr = await CollateralRegistry.deploy(admin.address, await oracle.getAddress());
    await cr.waitForDeployment();

    await cr.grantRole(OPERATOR_ROLE, operator.address);
    await cr.grantRole(TRADING_CORE_ROLE, core.address);

    // a fake token address + oracle feed
    const token = "0x00000000000000000000000000000000000000A1";
    const feed = "0x00000000000000000000000000000000000000F1";
    // price 1e18 (so 1 token unit with 18 decimals = $1 internal); set on the feed addr
    await oracle.setPrice(feed, ethers.parseUnits("1", 18), 0, await time());
    return { cr, oracle, admin, operator, core, other, token, feed };
}

async function time(): Promise<number> {
    return (await ethers.provider.getBlock("latest"))!.timestamp;
}

describe("CollateralRegistry", () => {
    describe("constructor", () => {
        it("reverts on zero admin or oracle", async () => {
            const CollateralRegistry = await ethers.getContractFactory("CollateralRegistry");
            await expect(
                CollateralRegistry.deploy(ethers.ZeroAddress, ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(CollateralRegistry, "ZeroAddress");
        });
    });

    describe("registerToken", () => {
        it("reverts on zero token/feed", async () => {
            const { cr, operator } = await loadFixture(deploy);
            await expect(
                cr.connect(operator).registerToken(ethers.ZeroAddress, 200, 500, 3000, 100, 100, 0, ethers.ZeroAddress, 18),
            ).to.be.revertedWithCustomError(cr, "ZeroAddress");
        });
        it("reverts on haircut over 100%", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await expect(
                cr.connect(operator).registerToken(token, 10001, 500, 3000, 100, 100, 0, feed, 18),
            ).to.be.revertedWithCustomError(cr, "InvalidHaircut");
        });
        it("registers a token and lists it", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await expect(cr.connect(operator).registerToken(token, 200, 500, 3000, 100, 100, 0, feed, 18)).to.emit(
                cr,
                "TokenRegistered",
            );
            const cfg = await cr.getCollateralConfig(token);
            expect(cfg.enabled).to.equal(true);
            expect(cfg.baseHaircutBps).to.equal(200);
            expect(await cr.getRegisteredTokens()).to.deep.equal([token]);
        });
        it("reverts on double registration", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 100, 100, 0, feed, 18);
            await expect(
                cr.connect(operator).registerToken(token, 200, 500, 3000, 100, 100, 0, feed, 18),
            ).to.be.revertedWithCustomError(cr, "TokenAlreadyRegistered");
        });
        it("only operator", async () => {
            const { cr, other, token, feed } = await loadFixture(deploy);
            await expect(cr.connect(other).registerToken(token, 200, 500, 3000, 100, 100, 0, feed, 18)).to.be.reverted;
        });
    });

    describe("setHaircut / setMaxExposure / setTokenEnabled", () => {
        it("setHaircut reverts on unregistered token", async () => {
            const { cr, operator, token } = await loadFixture(deploy);
            await expect(cr.connect(operator).setHaircut(token, 100, 200, 3000, 50, 50)).to.be.revertedWithCustomError(
                cr,
                "TokenNotRegistered",
            );
        });
        it("setHaircut updates config", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 100, 100, 0, feed, 18);
            await expect(cr.connect(operator).setHaircut(token, 300, 600, 4000, 50, 50)).to.emit(cr, "TokenUpdated");
            expect((await cr.getCollateralConfig(token)).baseHaircutBps).to.equal(300);
        });
        it("setMaxExposure reverts on unregistered", async () => {
            const { cr, operator, token } = await loadFixture(deploy);
            await expect(cr.connect(operator).setMaxExposure(token, 1000)).to.be.revertedWithCustomError(
                cr,
                "TokenNotRegistered",
            );
        });
        it("setTokenEnabled toggles", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 100, 100, 0, feed, 18);
            await expect(cr.connect(operator).setTokenEnabled(token, false)).to.emit(cr, "TokenPaused");
            expect((await cr.getCollateralConfig(token)).enabled).to.equal(false);
        });
    });

    describe("getEffectiveHaircut", () => {
        it("returns 0 for native USDC (zero address)", async () => {
            const { cr } = await loadFixture(deploy);
            expect(await cr.getEffectiveHaircut(ethers.ZeroAddress, 0, 0)).to.equal(0);
        });
        it("returns base haircut without utilization/volatility adders", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 0, 0, 0, feed, 18);
            expect(await cr.getEffectiveHaircut(token, 0, ethers.parseUnits("1", 18))).to.equal(200);
        });
        it("adds volatility adder when confidence exceeds 1% of price", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 0, 3000, 0, 150, 0, feed, 18);
            const price = ethers.parseUnits("1", 18);
            const highConf = price / 50n; // > price/100
            expect(await cr.getEffectiveHaircut(token, highConf, price)).to.equal(350);
        });
        it("clamps to maxHaircutBps", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 0, 250, 0, 500, 0, feed, 18);
            const price = ethers.parseUnits("1", 18);
            const highConf = price / 50n;
            // base 200 + 500 = 700, clamped to 250
            expect(await cr.getEffectiveHaircut(token, highConf, price)).to.equal(250);
        });
    });

    describe("getCollateralValue", () => {
        it("returns amount unchanged for native USDC", async () => {
            const { cr } = await loadFixture(deploy);
            expect(await cr.getCollateralValue(ethers.ZeroAddress, 12345, false)).to.equal(12345n);
        });
        it("reverts when token disabled", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 0, 0, 0, feed, 18);
            await cr.connect(operator).setTokenEnabled(token, false);
            await expect(cr.getCollateralValue(token, ethers.parseUnits("1", 18), false)).to.be.revertedWithCustomError(
                cr,
                "TokenDisabled",
            );
        });
        it("reverts on dust that rounds to zero", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 0, 0, 0, feed, 18);
            await expect(cr.getCollateralValue(token, 1, false)).to.be.revertedWithCustomError(cr, "InvalidParam");
        });
        it("applies base haircut to USDC value", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 0, 0, 0, feed, 18);
            // 1 full token (1e18) at price 1e18 -> grossUsdc = 1e18*1e18 / 10**(18+12) = 1e6
            // haircut 200bps -> 98% -> 980000
            const v = await cr.getCollateralValue(token, ethers.parseUnits("1", 18), false);
            expect(v).to.equal(980000n);
        });
        it("uses liquidation haircut when requested", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 0, 0, 0, feed, 18);
            const v = await cr.getCollateralValue(token, ethers.parseUnits("1", 18), true);
            // 500 bps -> 95% -> 950000
            expect(v).to.equal(950000n);
        });
    });

    describe("getTokenAmountForUsdc", () => {
        it("returns usdcValue for native USDC", async () => {
            const { cr } = await loadFixture(deploy);
            expect(await cr.getTokenAmountForUsdc(ethers.ZeroAddress, 1000, false)).to.equal(1000n);
        });
        it("rounds up token amount needed", async () => {
            const { cr, operator, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 200, 500, 3000, 0, 0, 0, feed, 18);
            const amt = await cr.getTokenAmountForUsdc(token, 980000, false);
            expect(amt).to.be.greaterThanOrEqual(ethers.parseUnits("1", 18));
        });
    });

    describe("recordDeposit / recordWithdrawal (TRADING_CORE_ROLE)", () => {
        it("only trading core may record", async () => {
            const { cr, other, token } = await loadFixture(deploy);
            await expect(cr.connect(other).recordDeposit(token, 100)).to.be.reverted;
        });
        it("no-ops for zero address token", async () => {
            const { cr, core } = await loadFixture(deploy);
            await cr.connect(core).recordDeposit(ethers.ZeroAddress, 100);
            await cr.connect(core).recordWithdrawal(ethers.ZeroAddress, 100);
        });
        it("tracks deposits and enforces max exposure", async () => {
            const { cr, operator, core, token, feed } = await loadFixture(deploy);
            // maxExposure small so a large deposit trips the cap
            await cr.connect(operator).registerToken(token, 0, 0, 3000, 0, 0, 500000, feed, 18);
            await cr.connect(core).recordDeposit(token, ethers.parseUnits("0.4", 18));
            expect(await cr.totalDeposited(token)).to.equal(ethers.parseUnits("0.4", 18));
            await expect(
                cr.connect(core).recordDeposit(token, ethers.parseUnits("1", 18)),
            ).to.be.revertedWithCustomError(cr, "ExceedsMaxExposure");
        });
        it("withdrawal clamps at zero when over-withdrawing", async () => {
            const { cr, operator, core, token, feed } = await loadFixture(deploy);
            await cr.connect(operator).registerToken(token, 0, 0, 3000, 0, 0, 0, feed, 18);
            await cr.connect(core).recordDeposit(token, ethers.parseUnits("1", 18));
            await cr.connect(core).recordWithdrawal(token, ethers.parseUnits("5", 18));
            expect(await cr.totalDeposited(token)).to.equal(0n);
        });
    });
});
