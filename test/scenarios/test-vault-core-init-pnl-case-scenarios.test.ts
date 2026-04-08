import { expect } from "chai";
import { ethers } from "hardhat";

describe("VaultCore init and pnl branch wave", function () {
  it("covers initialize zero-address guard and reinitializer protection", async function () {
    const [admin] = await ethers.getSigners();
    const usdc = await ethers.deployContract("MockUSDC");
    const vault = await ethers.deployContract("VaultCore");

    await expect(vault.initialize(ethers.ZeroAddress, await usdc.getAddress(), admin.address)).to.be.reverted;
    await expect(vault.initialize(admin.address, ethers.ZeroAddress, admin.address)).to.be.reverted;
    await expect(vault.initialize(admin.address, await usdc.getAddress(), ethers.ZeroAddress)).to.be.reverted;

    await vault.initialize(admin.address, await usdc.getAddress(), admin.address);
    await expect(vault.initialize(admin.address, await usdc.getAddress(), admin.address)).to.be.reverted;
  });

  it("covers totalAssets/getConservativeTotalAssets pnl branches", async function () {
    const [admin] = await ethers.getSigners();
    const usdc = await ethers.deployContract("MockUSDC");
    const vault = await ethers.deployContract("VaultCore");
    await vault.initialize(admin.address, await usdc.getAddress(), admin.address);

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
