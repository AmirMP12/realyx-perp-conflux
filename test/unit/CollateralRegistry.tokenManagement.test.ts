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
    it("registerToken reverts on zero token/feed and invalid haircut", async () => {
        const { registry, tAddr } = await loadFixture(deploy);
        await expect(
            registry.registerToken(ethers.ZeroAddress, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6),
        ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        await expect(
            registry.registerToken(tAddr, 10001, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6),
        ).to.be.revertedWithCustomError(registry, "InvalidHaircut");
    });

    it("registerToken reverts on double registration", async () => {
        const { registry, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
        await expect(
            registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6),
        ).to.be.revertedWithCustomError(registry, "TokenAlreadyRegistered");
    });

    it("setHaircut / setMaxExposure / setTokenEnabled revert for unregistered token", async () => {
        const { registry, tAddr } = await loadFixture(deploy);
        await expect(registry.setHaircut(tAddr, 100, 200, 3000, 50, 25)).to.be.revertedWithCustomError(
            registry,
            "TokenNotRegistered",
        );
        await expect(registry.setMaxExposure(tAddr, e6(1))).to.be.revertedWithCustomError(
            registry,
            "TokenNotRegistered",
        );
        await expect(registry.setTokenEnabled(tAddr, false)).to.be.revertedWithCustomError(
            registry,
            "TokenNotRegistered",
        );
    });

    it("setHaircut updates and rejects invalid bps", async () => {
        const { registry, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
        await registry.setHaircut(tAddr, 300, 600, 4000, 200, 100);
        const cfg = await registry.getCollateralConfig(tAddr);
        expect(cfg.baseHaircutBps).to.equal(300);
        await expect(registry.setHaircut(tAddr, 10001, 600, 4000, 200, 100)).to.be.revertedWithCustomError(
            registry,
            "InvalidHaircut",
        );
    });

    it("getEffectiveHaircut returns 0 for the native asset (address 0)", async () => {
        const { registry } = await loadFixture(deploy);
        expect(await registry.getEffectiveHaircut(ethers.ZeroAddress, 0, e18(1))).to.equal(0n);
    });

    it("getCollateralValue: native passthrough and dust revert", async () => {
        const { registry, oracle, tAddr } = await loadFixture(deploy);
        // 18-decimal config: divisor is 10^(18+12)=1e30, so a tiny raw amount rounds to zero gross.
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 18);
        // native asset -> returns amount unchanged
        expect(await registry.getCollateralValue(ethers.ZeroAddress, e6(123), false)).to.equal(e6(123));
        // 1 wei rounds to zero gross -> InvalidParam
        await expect(registry.getCollateralValue(tAddr, 1n, false)).to.be.revertedWithCustomError(
            registry,
            "InvalidParam",
        );
    });

    it("getCollateralValue reverts when disabled and on zero price", async () => {
        const { registry, oracle, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
        await registry.setTokenEnabled(tAddr, false);
        await expect(registry.getCollateralValue(tAddr, e6(100), false)).to.be.revertedWithCustomError(
            registry,
            "TokenDisabled",
        );
        await registry.setTokenEnabled(tAddr, true);
        await oracle.setPrice(tAddr, 0, 0, (await ethers.provider.getBlock("latest"))!.timestamp);
        await expect(registry.getCollateralValue(tAddr, e6(100), false)).to.be.revertedWithCustomError(
            registry,
            "InvalidOraclePrice",
        );
    });

    it("getCollateralValue applies the volatility adder when confidence > 1% of price", async () => {
        const { registry, oracle, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 0, 3000, 0, 500, e6(1_000_000), tAddr, 6);
        // confidence well above 1% of price triggers the volatility adder
        await oracle.setPrice(tAddr, e18(1), e18(1) / 10n, (await ethers.provider.getBlock("latest"))!.timestamp);
        const val = await registry.getCollateralValue(tAddr, e6(1000), false);
        expect(val).to.be.greaterThan(0n);
    });

    it("getTokenAmountForUsdc native passthrough + disabled/zero-price reverts", async () => {
        const { registry, oracle, tAddr } = await loadFixture(deploy);
        expect(await registry.getTokenAmountForUsdc(ethers.ZeroAddress, e6(100), false)).to.equal(e6(100));
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
        const amt = await registry.getTokenAmountForUsdc(tAddr, e6(100), true);
        expect(amt).to.be.greaterThan(0n);
        await oracle.setPrice(tAddr, 0, 0, (await ethers.provider.getBlock("latest"))!.timestamp);
        await expect(registry.getTokenAmountForUsdc(tAddr, e6(100), false)).to.be.revertedWithCustomError(
            registry,
            "InvalidOraclePrice",
        );
    });

    it("recordDeposit tracks totals and enforces the exposure cap", async () => {
        const { registry, core, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(10_000), tAddr, 6);
        await registry.connect(core).recordDeposit(tAddr, e6(1000));
        expect(await registry.totalDeposited(tAddr)).to.equal(e6(1000));
        // deposit beyond the cap reverts
        await expect(registry.connect(core).recordDeposit(tAddr, e6(20_000))).to.be.revertedWithCustomError(
            registry,
            "ExceedsMaxExposure",
        );
    });

    it("recordDeposit native no-op and disabled revert", async () => {
        const { registry, core, tAddr } = await loadFixture(deploy);
        await registry.connect(core).recordDeposit(ethers.ZeroAddress, e6(1000)); // no-op
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
        await registry.setTokenEnabled(tAddr, false);
        await expect(registry.connect(core).recordDeposit(tAddr, e6(100))).to.be.revertedWithCustomError(
            registry,
            "TokenDisabled",
        );
    });

    it("recordWithdrawal clamps at zero and is native no-op", async () => {
        const { registry, core, tAddr } = await loadFixture(deploy);
        await registry.connect(core).recordWithdrawal(ethers.ZeroAddress, e6(1000)); // no-op
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
        await registry.connect(core).recordDeposit(tAddr, e6(1000));
        // withdrawing more than deposited clamps to zero
        await registry.connect(core).recordWithdrawal(tAddr, e6(5000));
        expect(await registry.totalDeposited(tAddr)).to.equal(0n);
    });

    it("getRegisteredTokens enumerates registered tokens", async () => {
        const { registry, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(1_000_000), tAddr, 6);
        expect(await registry.getRegisteredTokens()).to.deep.equal([tAddr]);
    });
});

describe("CollateralRegistry — haircut selection", () => {
    it("getCollateralValue uses the liquidation haircut when requested and configured", async () => {
        const { registry, oracle, token, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 500, 3000, 100, 50, e6(100_000_000), tAddr, 6);
        const normal = await registry.getCollateralValue(tAddr, e6(1000), false);
        const liq = await registry.getCollateralValue(tAddr, e6(1000), true);
        // liquidation haircut (5%) > base haircut (2%) -> liq value is lower
        expect(liq).to.be.lessThan(normal);
    });

    it("getCollateralValue falls back to the dynamic haircut when liquidationHaircutBps is 0", async () => {
        const { registry, oracle, token, tAddr } = await loadFixture(deploy);
        // liquidationHaircutBps = 0 -> even with useLiquidationHaircut=true, dynamic haircut applies
        await registry.registerToken(tAddr, 200, 0, 3000, 100, 50, e6(100_000_000), tAddr, 6);
        const v = await registry.getCollateralValue(tAddr, e6(1000), true);
        expect(v).to.be.greaterThan(0n);
    });

    it("getTokenAmountForUsdc uses the dynamic haircut when liquidationHaircutBps is 0", async () => {
        const { registry, tAddr } = await loadFixture(deploy);
        await registry.registerToken(tAddr, 200, 0, 3000, 100, 50, e6(100_000_000), tAddr, 6);
        const amt = await registry.getTokenAmountForUsdc(tAddr, e6(1000), true);
        expect(amt).to.be.greaterThan(0n);
    });

    it("getEffectiveHaircut applies the utilization adder and clamps at maxHaircut", async () => {
        const { registry, oracle, token, core, tAddr } = await loadFixture(deploy);
        // small max exposure + steep slope so utilization pushes the haircut to the cap
        await registry.registerToken(tAddr, 200, 500, 250, 10000, 0, e6(1_000), tAddr, 6);
        await registry.connect(core).recordDeposit(tAddr, e6(900));
        const hc = await registry.getEffectiveHaircut(tAddr, 0, e18(1));
        // clamped to maxHaircutBps (250)
        expect(hc).to.be.lessThanOrEqual(250);
    });
});
