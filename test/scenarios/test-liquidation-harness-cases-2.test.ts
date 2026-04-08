import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("LiquidationLib Harness Additional Branches", function () {
    it("covers TWAP deviation and partial-cover fee-split paths", async function () {
        const env = await deployTestEnvironment();
        const market = env.alice.address;

        const Oracle = await ethers.getContractFactory("MockOracleSimple");
        const oracle = await Oracle.deploy();
        const Vault = await ethers.getContractFactory("MockVaultControl");
        const vault = await Vault.deploy();
        const PT = await ethers.getContractFactory("MockPositionTokenSimple");
        const pt = await PT.deploy();

        const LiqLib = await ethers.getContractFactory("LiquidationLib");
        const liqLib = await LiqLib.deploy();
        const Harness = await ethers.getContractFactory("LiquidationLibHarnessDeep", {
            libraries: {
                "contracts/libraries/LiquidationLib.sol:LiquidationLib": await liqLib.getAddress(),
            },
        });
        const h = await Harness.deploy(
            await env.usdc.getAddress(),
            await vault.getAddress(),
            await oracle.getAddress(),
            await pt.getAddress(),
            env.treasury.address
        );

        await env.usdc.mintTo(await h.getAddress(), ethers.parseUnits("1000000", 6));

        // Case 1: twap > 0 and deviation exceeds explicit liquidationDeviationBps.
        await h.setPosition(10n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(10n, 100_000_000_000_000_000n);
        await pt.setOwner(10n, env.alice.address);
        await oracle.setPrice(market, 1n * 10n ** 18n);
        await oracle.setTWAP(market, 100n * 10n ** 18n);
        await h.setLiqParams(100n, [500n, 800n, 1200n, 7000n]); // 1%
        await expect(h.liquidate(10n)).to.be.reverted;

        // Case 2: default maxDeviation path + covered < shortfall branch.
        await h.setPosition(11n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(11n, 1_000_000_000_000n);
        await pt.setOwner(11n, env.alice.address);
        await oracle.setPrice(market, 1n * 10n ** 18n);
        await oracle.setTWAP(market, 0n); // bypass deviation check path via twap == 0
        await h.setLiqParams(0n, [500n, 800n, 1200n, 7000n]); // use MAX_LIQUIDATION_PRICE_DEVIATION_BPS path
        await vault.setCoverAmount(1n); // partial cover (likely < shortfall)
        await expect(h.liquidate(11n)).to.be.reverted;

        // Case 3: zero-fee tiers to drive no-shortfall + pnl>=0 + liquidatorReward==0 branches.
        await h.setPosition(12n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(12n, 1n);
        await pt.setOwner(12n, env.alice.address);
        await oracle.setPrice(market, 100n * 10n ** 18n); // pnl == 0, so pnl>=0 arm
        await oracle.setTWAP(market, 0n);
        await h.setLiqParams(0n, [0n, 0n, 0n, 0n]); // liqFeeUsdc = 0 => reward floor check false, transfer branch false
        await vault.setCoverAmount(0n);
        await h.liquidate(12n);
    });
});
