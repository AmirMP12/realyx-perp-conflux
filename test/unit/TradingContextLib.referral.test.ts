import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);

/**
 * Drives the referral resolution of TradingContextLib.buildCloseCtx:
 *   - valid referral data is copied into the context
 *   - discount/rebate are clamped to BPS
 *   - configurations whose discount + rebate exceed 100% are rejected (unreferred)
 *   - a reverting registry is swallowed (never bricks a close)
 */
describe("TradingContextLib — referral resolution", () => {
    async function deploy() {
        const [admin, trader, referrer, treasury] = await ethers.getSigners();
        const libs = await deployAllLibraries();
        const harness = await deployHarness("TradingContextLibHarness", libs);

        const USDC = await ethers.getContractFactory("MockUSDC");
        const usdc = await USDC.deploy();
        await usdc.waitForDeployment();

        const Vault = await ethers.getContractFactory("MockVaultControl");
        const vault = await Vault.deploy();
        await vault.waitForDeployment();

        const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();

        const PT = await ethers.getContractFactory("MockPositionTokenSimple");
        const pt = await PT.deploy();
        await pt.waitForDeployment();

        const Reg = await ethers.getContractFactory("MockReferralRegistryConfigurable");
        const reg = await Reg.deploy();
        await reg.waitForDeployment();

        const feeConfig = {
            makerFeeBps: 5,
            takerFeeBps: 10,
            minFeeUsdc: e6(1),
            lpShareBps: 7000,
            insuranceShareBps: 2000,
            treasuryShareBps: 1000,
        };

        const build = (registryAddr: string) =>
            harness.buildCloseCtx(
                usdc.getAddress(),
                vault.getAddress(),
                oracle.getAddress(),
                pt.getAddress(),
                treasury.address,
                vault.getAddress(),
                ethers.ZeroAddress,
                feeConfig,
                registryAddr,
                trader.address,
            );

        return { harness, reg, referrer, build };
    }

    it("copies valid referral data into the close context", async () => {
        const { reg, referrer, build } = await loadFixture(deploy);
        await reg.setData(referrer.address, 300, 200, 1);
        const ctx = await build(await reg.getAddress());
        expect(ctx.referrer).to.equal(referrer.address);
        expect(ctx.referralDiscountBps).to.equal(300n);
        expect(ctx.referralRebateBps).to.equal(200n);
    });

    it("clamps discount and rebate above BPS then rejects the unsafe sum", async () => {
        const { reg, referrer, build } = await loadFixture(deploy);
        // both clamp to 10000 -> sum 20000 > 10000 -> treated as unreferred
        await reg.setData(referrer.address, 20000, 20000, 1);
        const ctx = await build(await reg.getAddress());
        expect(ctx.referrer).to.equal(ethers.ZeroAddress);
        expect(ctx.referralDiscountBps).to.equal(0n);
        expect(ctx.referralRebateBps).to.equal(0n);
    });

    it("rejects configurations whose discount + rebate exceed 100%", async () => {
        const { reg, referrer, build } = await loadFixture(deploy);
        await reg.setData(referrer.address, 6000, 5000, 1); // sum 11000 > 10000
        const ctx = await build(await reg.getAddress());
        expect(ctx.referrer).to.equal(ethers.ZeroAddress);
    });

    it("swallows a reverting registry (close never bricks)", async () => {
        const { reg, build } = await loadFixture(deploy);
        await reg.setShouldRevert(true);
        const ctx = await build(await reg.getAddress());
        expect(ctx.referrer).to.equal(ethers.ZeroAddress);
        expect(ctx.referralDiscountBps).to.equal(0n);
    });

    it("no referral registry yields an unreferred context", async () => {
        const { build } = await loadFixture(deploy);
        const ctx = await build(ethers.ZeroAddress);
        expect(ctx.referrer).to.equal(ethers.ZeroAddress);
    });
});
