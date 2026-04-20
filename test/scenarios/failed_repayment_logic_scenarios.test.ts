import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingLib failed-repayment branch wave", function () {
  async function deployHarnessFixture() {
    const env = await deployTestEnvironment();
    const Harness = await ethers.getContractFactory("TradingLibFailedRepaymentHarness", {
      libraries: {
        "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
      },
    });
    const harness = await Harness.deploy();
    const vault = await ethers.deployContract("MockVaultControl");
    return { env, harness, vault };
  }

  it("covers resolveFailedRepayment success and catch branches", async function () {
    const { env, harness, vault } = await loadFixture(deployHarnessFixture);
    const [admin] = await ethers.getSigners();
    const usdcAddr = await env.usdc.getAddress();
    const market = ethers.Wallet.createRandom().address;

    await harness.boostRecordFailedRepayment(101, 2_000_000n, market, true, 0);

    await vault.setRevertRepay(true);
    await env.usdc.mintTo(admin.address, 5_000_000n);
    await env.usdc.approve(await harness.getAddress(), ethers.MaxUint256);
    await expect(
      harness.boostResolveFailedRepayment(101, admin.address, await harness.getAddress(), usdcAddr, await vault.getAddress())
    ).to.be.reverted;

    await vault.setRevertRepay(false);
    await harness.boostResolveFailedRepayment(101, admin.address, await harness.getAddress(), usdcAddr, await vault.getAddress());

    await expect(
      harness.boostResolveFailedRepayment(101, admin.address, await harness.getAddress(), usdcAddr, await vault.getAddress())
    ).to.be.reverted;
  });

  it("covers resolveFailedRepaymentFull index-removal/debt update arms", async function () {
    const { env, harness, vault } = await loadFixture(deployHarnessFixture);
    const [admin] = await ethers.getSigners();
    const usdcAddr = await env.usdc.getAddress();
    const market = ethers.Wallet.createRandom().address;

    await harness.boostRecordFailedRepayment(201, 1_000_000n, market, true, 0);
    await harness.boostApplyLiquidatePostProcess(201, true, 0, 1_000_000n, 0);

    await env.usdc.mintTo(admin.address, 3_000_000n);
    await env.usdc.approve(await harness.getAddress(), ethers.MaxUint256);

    const [newTotal, badDebt] = await harness.boostResolveFailedRepaymentFull.staticCall(
      201,
      admin.address,
      await harness.getAddress(),
      usdcAddr,
      await vault.getAddress(),
      1
    );
    expect(newTotal).to.equal(0n);
    expect(badDebt).to.equal(0n);

    await harness.boostResolveFailedRepaymentFull(
      201,
      admin.address,
      await harness.getAddress(),
      usdcAddr,
      await vault.getAddress(),
      1
    );
  });

  it("covers resolveFailedRepayment when self already holds full amount", async function () {
    const { env, harness, vault } = await loadFixture(deployHarnessFixture);
    const [admin] = await ethers.getSigners();
    const hAddr = await harness.getAddress();
    const usdcAddr = await env.usdc.getAddress();
    const market = ethers.Wallet.createRandom().address;

    await harness.boostRecordFailedRepayment(303, 500_000n, market, false, -100n);
    await env.usdc.mintTo(hAddr, 1_000_000n);
    await harness.boostResolveFailedRepayment(303, admin.address, hAddr, usdcAddr, await vault.getAddress());
  });
});
