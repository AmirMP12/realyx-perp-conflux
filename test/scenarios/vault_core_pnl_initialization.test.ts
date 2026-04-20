import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("VaultCore init and pnl branch wave", function () {
  it("covers initialize zero-address guard and reinitializer protection", async function () {
    const [admin] = await ethers.getSigners();
    const usdc = await ethers.deployContract("MockUSDC");
    const VaultCore = await ethers.getContractFactory("VaultCore");
    const vault = await upgrades.deployProxy(VaultCore, [admin.address, await usdc.getAddress(), admin.address], {
      kind: "uups",
      initializer: "initialize",
    });
    await vault.waitForDeployment();

    await expect(
      upgrades.deployProxy(VaultCore, [ethers.ZeroAddress, await usdc.getAddress(), admin.address], {
        kind: "uups",
        initializer: "initialize",
      }),
    ).to.be.reverted;
    await expect(
      upgrades.deployProxy(VaultCore, [admin.address, ethers.ZeroAddress, admin.address], {
        kind: "uups",
        initializer: "initialize",
      }),
    ).to.be.reverted;
    await expect(
      upgrades.deployProxy(VaultCore, [admin.address, await usdc.getAddress(), ethers.ZeroAddress], {
        kind: "uups",
        initializer: "initialize",
      }),
    ).to.be.reverted;

    await expect(
      vault.initialize(admin.address, await usdc.getAddress(), admin.address),
    ).to.be.revertedWithCustomError(vault, "InvalidInitialization");
  });

  it("covers totalAssets/getConservativeTotalAssets pnl branches", async function () {
    const [admin] = await ethers.getSigners();
    const usdc = await ethers.deployContract("MockUSDC");
    const VaultCore = await ethers.getContractFactory("VaultCore");
    const vault = await upgrades.deployProxy(VaultCore, [admin.address, await usdc.getAddress(), admin.address], {
      kind: "uups",
      initializer: "initialize",
    });
    await vault.waitForDeployment();

    const tc = await ethers.deployContract("MockTradingCorePnl");
    await vault.setTradingCore(await tc.getAddress());

    await usdc.mintTo(await vault.getAddress(), 2_000_000_000n);

    await tc.setPnl(100_000_000n);
    await vault.totalAssets();
    await vault.getConservativeTotalAssets();

    await tc.setPnl(-100_000_000n);
    await vault.totalAssets();
    await vault.getConservativeTotalAssets();

    await tc.setShouldRevert(true);
    await vault.totalAssets();
    await vault.getConservativeTotalAssets();
  });
});
