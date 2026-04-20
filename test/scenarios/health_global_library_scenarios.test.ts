import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("GlobalPnLLib and HealthLib branch wave", function () {
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
    return { harness };
  }

  it("covers zero-price and unhealthy protocol branches", async function () {
    const { harness } = await loadFixture(deployHarnessFixture);
    const oracle = await ethers.deployContract("MockOracleSimple");
    const m = ethers.Wallet.createRandom().address;

    await harness.addMarket(m);
    await harness.setMarketExposure(m, true, 1000n * 10n ** 18n, 1000n * 10n ** 18n, 0n, 0n);
    await oracle.setPrice(m, 0n);
    expect(await harness.testGlobalPnL(await oracle.getAddress())).to.equal(0n);

    await harness.setProtocolHealth(true, 1_000_000n, 0);
    await harness.testUpdateProtocolHealth(1n);
    const ph = await harness.protocolHealth();
    expect(ph.isHealthy).to.equal(false);

    // Exercise GlobalPnLLib short-only arm in the (long || short) gate.
    const m2 = ethers.Wallet.createRandom().address;
    await harness.addMarket(m2);
    await harness.setMarketExposure(m2, true, 0n, 0n, 500n * 10n ** 18n, 500n * 10n ** 18n);
    await oracle.setPrice(m2, 120n * 10n ** 18n);
    await harness.testGlobalPnL(await oracle.getAddress());
  });
});
