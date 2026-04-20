import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingLib cancelOrder branch wave", function () {
  async function deployHarnessFixture() {
    const env = await deployTestEnvironment();
    const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
      libraries: {
        "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
        "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
      },
    });
    const monitoringLib = await MonitoringLib.deploy();
    const CoverageHarness = await ethers.getContractFactory("CoverageHarness", {
      libraries: {
        "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
        "contracts/libraries/MonitoringLib.sol:MonitoringLib": await monitoringLib.getAddress(),
        "contracts/libraries/CleanupLib.sol:CleanupLib": env.libs.cleanupLib,
        "contracts/libraries/ConfigLib.sol:ConfigLib": env.libs.configLib,
        "contracts/libraries/DustLib.sol:DustLib": env.libs.dustLib,
        "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": env.libs.flashLib,
        "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
        "contracts/libraries/RateLimitLib.sol:RateLimitLib": env.libs.rateLimitLib,
        "contracts/libraries/WithdrawLib.sol:WithdrawLib": env.libs.withdrawLib,
      },
    });
    const harness = await CoverageHarness.deploy();
    return { env, harness };
  }

  it("covers collateral refund + execution fee refund branches", async function () {
    const { env, harness } = await loadFixture(deployHarnessFixture);
    const [, alice] = await ethers.getSigners();
    // MARKET_INCREASE = 0, collateralDelta internal units via toUsdcPrecision in cancelOrder
    // collateralDelta is internal precision; 1e18 internal => 1e6 USDC
    await harness.boostCancelOrder(1n, alice.address, alice.address, 1_000_000_000_000_000_000n, 0, 500_000n);
    expect(await harness.orderRefundBalance(alice.address)).to.equal(500_000n);
    expect(await harness.orderCollateralRefundBalance(alice.address)).to.be.gt(0n);
  });

  it("covers no-refund path for MARKET_DECREASE", async function () {
    const { harness } = await loadFixture(deployHarnessFixture);
    const [, alice] = await ethers.getSigners();
    // MARKET_DECREASE = 1 — collateral refund branch false
    await harness.boostCancelOrder(2n, alice.address, alice.address, 2_000_000n, 1, 100n);
    expect(await harness.orderCollateralRefundBalance(alice.address)).to.equal(0n);
  });
});
