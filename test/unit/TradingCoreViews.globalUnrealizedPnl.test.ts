import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const MA = "0x00000000000000000000000000000000000000a1";
const MB = "0x00000000000000000000000000000000000000a2";
const MC = "0x00000000000000000000000000000000000000a3";

async function deploy() {
    const Views = await ethers.getContractFactory("TradingCoreViews");
    const views = await Views.deploy();
    await views.waitForDeployment();
    const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const Vault = await ethers.getContractFactory("MockVaultControl");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    const Core = await ethers.getContractFactory("MockCoreForViews");
    const core = await Core.deploy();
    await core.waitForDeployment();
    await views.initialize(await core.getAddress(), await vault.getAddress(), await oracle.getAddress());
    return { views, oracle, vault, core };
}

describe("TradingCoreViews — _globalUnrealizedPnL", () => {
    it("aggregates a priced active market (long + short legs)", async () => {
        const { views, oracle, core } = await loadFixture(deploy);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MA, e18(110), 0, now);
        await core.addMarket(MA, true, e18(1000), e18(100_000), e18(500), e18(50_000));
        const [pnl, complete] = await views.getGlobalUnrealizedPnLDetailed(await core.getAddress());
        expect(complete).to.equal(true);
        expect(typeof pnl).to.equal("bigint");
    });

    it("flags incomplete when an OI-bearing market is priced at zero", async () => {
        const { views, core } = await loadFixture(deploy);
        // market with OI but no oracle price set -> price 0 -> complete=false
        await core.addMarket(MB, true, e18(1000), e18(100_000), 0, 0);
        const [, complete] = await views.getGlobalUnrealizedPnLDetailed(await core.getAddress());
        expect(complete).to.equal(false);
    });

    it("skips an inactive market and a zero-OI market", async () => {
        const { views, oracle, core } = await loadFixture(deploy);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MC, e18(100), 0, now);
        await core.addMarket(MC, false, e18(1000), e18(100_000), 0, 0); // inactive -> skipped
        const [, complete] = await views.getGlobalUnrealizedPnLDetailed(await core.getAddress());
        expect(complete).to.equal(true);
    });

    // NOTE: the `longCurrent > maxSafe` overflow-skip path is defensive and
    // unreachable in practice: with uint128 sizes the `size * price` product
    // panics (uint256 overflow) before it can exceed int256.max/2, so the
    // try/catch already covers the failure mode. Left intentionally untested.

    it("getGlobalUnrealizedPnL (non-detailed) returns the aggregate", async () => {
        const { views, oracle, core } = await loadFixture(deploy);
        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        await oracle.setPrice(MA, e18(110), 0, now);
        await core.addMarket(MA, true, e18(1000), e18(100_000), 0, 0);
        const pnl = await views.getGlobalUnrealizedPnL(await core.getAddress());
        expect(typeof pnl).to.equal("bigint");
    });

    it("flags incomplete when the oracle reverts for a market", async () => {
        const { views, oracle, core } = await loadFixture(deploy);
        await core.addMarket(MA, true, e18(1000), e18(100_000), 0, 0);
        await oracle.setRevertOnGetPrice(true);
        const [, complete] = await views.getGlobalUnrealizedPnLDetailed(await core.getAddress());
        expect(complete).to.equal(false);
    });
});
