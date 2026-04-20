import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("Liquidation Library Exhaustive Component Scenarios", function () {
    it("hits not-open/not-liquidatable/repay-fail/reward-floor branches", async function () {
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
        await oracle.setPrice(market, 100n * 10n ** 18n);
        await pt.setOwner(1n, env.alice.address);

        // PositionNotFound (state != OPEN)
        await h.setPosition(1n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 2);
        await h.setCollateral(1n, 100_000_000_000_000_000n);
        await expect(h.liquidate(1n)).to.be.reverted;

        // PositionNotLiquidatable (deeply overcollateralized).
        await h.setPosition(2n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(2n, 5_000_000_000_000_000_000n);
        await pt.setOwner(2n, env.alice.address);
        await expect(h.liquidate(2n)).to.be.reverted;

        // RepayFailed branch (vault repay revert).
        await h.setPosition(3n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(3n, 100_000_000_000_000_000n);
        await pt.setOwner(3n, env.alice.address);
        await oracle.setPrice(market, 1n * 10n ** 18n);
        await vault.setRevertRepay(true);
        await expect(h.liquidate(3n)).to.be.reverted;
        await vault.setRevertRepay(false);

        // Reward floor branch (InsufficientLiquidatorReward): tiny size -> tiny liqFee.
        await h.setPosition(4n, market, 10_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(4n, 1n);
        await pt.setOwner(4n, env.alice.address);
        await oracle.setPrice(market, 1n * 10n ** 18n);
        await vault.setCoverAmount(0n);
        await expect(h.liquidate(4n)).to.be.reverted;
    });
});
