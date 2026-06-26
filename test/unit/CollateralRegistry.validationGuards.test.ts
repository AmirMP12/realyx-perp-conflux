import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TRADING_CORE_ROLE } from "../helpers/constants";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

async function deploy() {
    const [admin, core, user] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Mock.deploy();
    await oracle.waitForDeployment();
    const Registry = await ethers.getContractFactory("CollateralRegistry");
    const registry = await Registry.deploy(admin.address, await oracle.getAddress());
    await registry.waitForDeployment();
    await registry.grantRole(TRADING_CORE_ROLE, core.address);

    const Token = await ethers.getContractFactory("MockUSDC");
    const token = await Token.deploy();
    await token.waitForDeployment();
    const tAddr = await token.getAddress();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(tAddr, e18(1), 0, now);
    return { registry, oracle, token, tAddr, admin, core, user };
}

describe("CollateralRegistry", () => {
    describe("constructor guards", () => {
        it("reverts when admin is zero", async () => {
            const Mock = await ethers.getContractFactory("MockOracleConfigurable");
            const oracle = await Mock.deploy();
            await oracle.waitForDeployment();
            const Registry = await ethers.getContractFactory("CollateralRegistry");
            await expect(
                Registry.deploy(ethers.ZeroAddress, await oracle.getAddress()),
            ).to.be.revertedWithCustomError(Registry, "ZeroAddress");
        });

        it("reverts when the oracle is zero", async () => {
            const [admin] = await ethers.getSigners();
            const Registry = await ethers.getContractFactory("CollateralRegistry");
            await expect(Registry.deploy(admin.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(
                Registry,
                "ZeroAddress",
            );
        });
    });

    describe("registerToken guards", () => {
        it("reverts when the oracle feed is zero", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await expect(
                registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), ethers.ZeroAddress, 6),
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });

        it("reverts when liquidationHaircutBps or maxHaircutBps exceed 10000", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await expect(
                registry.registerToken(tAddr, 200, 10001, 3000, 100, 50, e6(1_000_000), tAddr, 6),
            ).to.be.revertedWithCustomError(registry, "InvalidHaircut");
            await expect(
                registry.registerToken(tAddr, 200, 500, 10001, 100, 50, e6(1_000_000), tAddr, 6),
            ).to.be.revertedWithCustomError(registry, "InvalidHaircut");
        });

        it("reverts for a non-operator caller", async () => {
            const { registry, tAddr, user } = await loadFixture(deploy);
            await expect(
                registry.connect(user).registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6),
            ).to.be.reverted;
        });
    });

    describe("getEffectiveHaircut", () => {
        it("returns the base haircut when no utilization adder applies (zero slope)", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            // utilizationSlopeBps = 0 -> no utilization adder, volatilityAdderBps = 0 -> no volatility adder
            await registry.registerToken(tAddr, 200, 500, 3000, 0, 0, e6(1_000_000), tAddr, 6);
            expect(await registry.getEffectiveHaircut(tAddr, 0, e18(1))).to.equal(200);
        });

        it("does not add the volatility adder when confidence is below 1% of price", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await registry.registerToken(tAddr, 200, 500, 3000, 0, 500, e6(1_000_000), tAddr, 6);
            // confidence (0) <= price/100 -> no volatility adder, stays at base 200
            expect(await registry.getEffectiveHaircut(tAddr, 0, e18(1))).to.equal(200);
        });

        it("skips the utilization adder when price is zero", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
            // price == 0 -> both conditional adders skipped, returns base
            expect(await registry.getEffectiveHaircut(tAddr, 0, 0)).to.equal(200);
        });
    });

    describe("setHaircut guards", () => {
        it("reverts when liquidation/max haircut bps exceed 10000", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
            await expect(registry.setHaircut(tAddr, 200, 10001, 3000, 100, 50)).to.be.revertedWithCustomError(
                registry,
                "InvalidHaircut",
            );
            await expect(registry.setHaircut(tAddr, 200, 500, 10001, 100, 50)).to.be.revertedWithCustomError(
                registry,
                "InvalidHaircut",
            );
        });
    });

    describe("setMaxExposure / setTokenEnabled success paths", () => {
        it("setMaxExposure updates the cap and emits", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
            await expect(registry.setMaxExposure(tAddr, e6(2_000_000))).to.emit(registry, "TokenUpdated");
            const cfg = await registry.getCollateralConfig(tAddr);
            expect(cfg.maxProtocolExposure).to.equal(e6(2_000_000));
        });

        it("setTokenEnabled toggles and emits TokenPaused", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
            await expect(registry.setTokenEnabled(tAddr, false)).to.emit(registry, "TokenPaused").withArgs(tAddr, true);
            const cfg = await registry.getCollateralConfig(tAddr);
            expect(cfg.enabled).to.equal(false);
        });
    });

    describe("getTokenAmountForUsdc disabled guard", () => {
        it("reverts when the token is disabled", async () => {
            const { registry, tAddr } = await loadFixture(deploy);
            await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
            await registry.setTokenEnabled(tAddr, false);
            await expect(registry.getTokenAmountForUsdc(tAddr, e6(100), false)).to.be.revertedWithCustomError(
                registry,
                "TokenDisabled",
            );
        });
    });

    describe("recordDeposit no-cap path", () => {
        it("skips the exposure check when maxProtocolExposure is zero", async () => {
            const { registry, core, tAddr } = await loadFixture(deploy);
            // maxProtocolExposure = 0 -> cap branch skipped entirely
            await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, 0, tAddr, 6);
            await registry.connect(core).recordDeposit(tAddr, e6(5_000));
            expect(await registry.totalDeposited(tAddr)).to.equal(e6(5_000));
        });
    });

    describe("recordWithdrawal exact path", () => {
        it("subtracts exactly when withdrawing within the deposited balance", async () => {
            const { registry, core, tAddr } = await loadFixture(deploy);
            await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
            await registry.connect(core).recordDeposit(tAddr, e6(1_000));
            await registry.connect(core).recordWithdrawal(tAddr, e6(400));
            expect(await registry.totalDeposited(tAddr)).to.equal(e6(600));
        });
    });
});
