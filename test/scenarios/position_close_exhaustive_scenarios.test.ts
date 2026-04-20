import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("PositionCloseLib Harness Deep Branches", function () {
    it("hits zero/exceeds/slippage and shortfall branches", async function () {
        const env = await deployTestEnvironment();
        const market = env.alice.address;

        const Oracle = await ethers.getContractFactory("MockOracleSimple");
        const oracle = await Oracle.deploy();
        const Vault = await ethers.getContractFactory("MockVaultControl");
        const vault = await Vault.deploy();
        const PT = await ethers.getContractFactory("MockPositionTokenSimple");
        const pt = await PT.deploy();

        const PosCloseLib = await ethers.getContractFactory("PositionCloseLib");
        const posCloseLib = await PosCloseLib.deploy();
        const Harness = await ethers.getContractFactory("PositionCloseLibHarness", {
            libraries: {
                "contracts/libraries/PositionCloseLib.sol:PositionCloseLib": await posCloseLib.getAddress(),
            },
        });
        const h = await Harness.deploy(
            await env.usdc.getAddress(),
            await vault.getAddress(),
            await oracle.getAddress(),
            await pt.getAddress(),
            env.treasury.address
        );

        await h.setMarket(market, 500);
        await h.setPosition(1n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(1n, 300_000_000_000_000_000n);
        await h.setUserExposure(env.alice.address, 1_000_000_000n);
        await pt.setOwner(1n, env.alice.address);
        await oracle.setPrice(market, 120n * 10n ** 18n);
        await env.usdc.mintTo(await h.getAddress(), ethers.parseUnits("1000000", 6));

        await expect(h.close(1n, 0n, 0n)).to.be.reverted;
        await expect(h.close(1n, 2_000_000_000_000_000_000n, 0n)).to.be.reverted;

        // Positive payout with high minReceive should hit SlippageExceeded branch.
        await expect(h.close(1n, 1_000_000_000_000_000_000n, ethers.MaxUint256)).to.be.reverted;

        // Re-seed and force shortfall with cover=0 to hit covered<shortfall and covered==0 branch.
        await h.setPosition(2n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(2n, 1n);
        await pt.setOwner(2n, env.alice.address);
        await oracle.setPrice(market, 1n * 10n ** 18n);
        await vault.setCoverAmount(0n);
        await h.close(2n, 1_000_000_000_000_000_000n, 0n);

        // Re-seed and force coverBadDebt catch branch.
        await h.setPosition(3n, market, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1);
        await h.setCollateral(3n, 1n);
        await pt.setOwner(3n, env.alice.address);
        await vault.setRevertCover(true);
        await h.close(3n, 1_000_000_000_000_000_000n, 0n);
    });
});
