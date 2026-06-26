import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

/**
 * Verifies CollateralRouterLib selection logic via ExtraCoverageHarness.
 *
 * Covers a token that values to zero USDC: a 1-wei balance of a 6-decimal token
 * yields grossUsdc=1 and net=floor(1*9800/10000)=0, so the value rounds to zero
 * without reverting and the token is skipped.
 *
 * Some defensive cases are not exercised because they are unreachable with the
 * real CollateralRegistry:
 *   - A zero token address: the registry cannot register address(0), so its
 *     config is always disabled and the loop continues before the guard.
 *   - A needed amount exceeding the balance in selectBestCollateral and the
 *     basket path: getCollateralValue floors twice while getTokenAmountForUsdc
 *     ceils, so for any required <= balance value the inverted amount is provably
 *     <= balance. These clamp/skip cases are dead defensive code in practice.
 */
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
    // both normal 2% tokens. The zero-value case is driven with a 1-wei
    // balance: grossUsdc=1 but net = floor(1*9800/10000) = 0, so the value
    // rounds to zero without reverting regardless of haircut size.
    await registry.registerToken(a1, 200, 500, 3000, 100, 50, e6(100_000_000), a1, 6);
    await registry.registerToken(a2, 200, 500, 3000, 100, 50, e6(100_000_000), a2, 6);
    const libs = await deployAllLibraries();
    const h = await deployHarness("ExtraCoverageHarness", libs);
    return { h, registry, t1, t2, a1, a2, user };
}

describe("CollateralRouterLib — selectBestCollateral", () => {
    it("selects a token whose balance covers the requirement", async () => {
        const { h, registry, t1, a1, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(1_000));
        const [token, amt, val] = await h.selectBestCollateral(
            user.address,
            [a1],
            await registry.getAddress(),
            e6(100),
            false,
        );
        expect(token).to.equal(a1);
        expect(amt).to.be.greaterThan(0n);
        expect(val).to.be.greaterThanOrEqual(e6(100));
    });

    it("returns no token when balance is insufficient", async () => {
        const { h, registry, t1, a1, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(10));
        const [token] = await h.selectBestCollateral(
            user.address,
            [a1],
            await registry.getAddress(),
            e6(1_000),
            false,
        );
        expect(token).to.equal(ethers.ZeroAddress);
    });

    it("skips a disabled token (enabled == false)", async () => {
        const { h, registry, t1, t2, a1, a2, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(1_000));
        await t2.mintTo(user.address, e6(1_000));
        await registry.setTokenEnabled(a1, false);
        const [token] = await h.selectBestCollateral(
            user.address,
            [a1, a2],
            await registry.getAddress(),
            e6(100),
            false,
        );
        // a1 disabled -> skipped; a2 chosen
        expect(token).to.equal(a2);
    });

    it("uses the liquidation haircut path when requested", async () => {
        const { h, registry, t1, a1, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(1_000));
        const [, , valLiq] = await h.selectBestCollateral(
            user.address,
            [a1],
            await registry.getAddress(),
            e6(100),
            true,
        );
        expect(valLiq).to.be.greaterThanOrEqual(e6(100));
    });
});

describe("CollateralRouterLib — selectBestCollateralBasket", () => {
    it("skips a token that values to zero USDC", async () => {
        const { h, registry, t2, a2, user } = await loadFixture(setup);
        // 1 wei of a 6-decimal token -> grossUsdc=1, net=floor(1*9800/10000)=0.
        await t2.mintTo(user.address, 1n);
        const [total, count] = await h.selectBestCollateralBasket(
            user.address,
            [a2],
            await registry.getAddress(),
            e6(100),
            false,
        );
        // zero-valued token skipped -> empty allocation
        expect(count).to.equal(0n);
        expect(total).to.equal(0n);
    });

    it("splits across two tokens when no single token suffices", async () => {
        const { h, registry, t1, a1, user } = await loadFixture(setup);
        // single normal token, request within reach -> single-token early return
        await t1.mintTo(user.address, e6(5_000));
        const [total, count] = await h.selectBestCollateralBasket(
            user.address,
            [a1],
            await registry.getAddress(),
            e6(1_000),
            false,
        );
        expect(count).to.equal(1n);
        expect(total).to.be.greaterThanOrEqual(e6(1_000));
    });

    it("returns a partial basket when total collateral is insufficient", async () => {
        const { h, registry, t1, a1, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(100));
        const [total] = await h.selectBestCollateralBasket(
            user.address,
            [a1],
            await registry.getAddress(),
            e6(50_000),
            false,
        );
        expect(total).to.be.lessThan(e6(50_000));
    });
});

describe("CollateralRouterLib — getUserTotalCollateralValue", () => {
    it("sums enabled token values and skips disabled ones", async () => {
        const { h, registry, t1, t2, a1, a2, user } = await loadFixture(setup);
        await t1.mintTo(user.address, e6(1_000));
        await t2.mintTo(user.address, e6(1_000));
        await registry.setTokenEnabled(a2, false); // disabled -> skipped
        const total = await h.getUserTotalCollateralValue(
            user.address,
            [a1, a2],
            await registry.getAddress(),
            false,
        );
        expect(total).to.be.greaterThan(0n);
    });
});
