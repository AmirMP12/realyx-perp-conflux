import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingLib collateral branch wave", function () {
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
        "contracts/libraries/CircuitBreakerLib.sol:CircuitBreakerLib": env.libs.circuitBreakerLib,
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
    const oracle = await ethers.deployContract("MockOracleSimple");

    return { env, harness, oracle };
  }

  it("covers addCollateral emergency/oracle/maxLeverage branches", async function () {
    const { env, harness, oracle } = await loadFixture(deployHarnessFixture);
    const market = ethers.Wallet.createRandom().address;
    const usdcAddr = await env.usdc.getAddress();
    const oracleAddr = await oracle.getAddress();

    await harness.testSetMarket(
      market,
      ethers.Wallet.createRandom().address,
      20,
      1_000_000_000,
      1_000_000_000,
      500,
      1000,
      3600,
      200
    );
    await harness.setPosition(1, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1, market);
    await harness.setCollateral(1, 2_000_000_000_000_000_000n);

    await env.usdc.mintTo(await harness.getAddress(), 0); // no-op to ensure token deployed
    await env.usdc.mintTo((await ethers.getSigners())[0].address, 5_000_000_000n);
    await env.usdc.approve(await harness.getAddress(), ethers.MaxUint256);

    // emergency + active market => MarketNotActive
    await expect(harness.testAddCollateral(1, 1_000_000n, 0, true, usdcAddr, oracleAddr, 1000)).to.be.reverted;

    // non-emergency + price zero => InvalidOraclePrice
    await expect(harness.testAddCollateral(1, 1_000_000n, 0, false, usdcAddr, oracleAddr, 1000)).to.be.reverted;

    // deactivate market and hit emergency success path (oracle skipped)
    await harness.setUnlistMarket(market);
    await harness.testAddCollateral(1, 1_000_000n, 0, true, usdcAddr, oracleAddr, 1000);

    // maxLeverage guard branch
    await harness.setPosition(1, 10_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1, market);
    await expect(harness.testAddCollateral(1, 1_000_000n, 1, true, usdcAddr, oracleAddr, 1000)).to.be.reverted;
  });

  it("covers withdrawCollateral insufficient and success branches", async function () {
    const { env, harness, oracle } = await loadFixture(deployHarnessFixture);
    const market = ethers.Wallet.createRandom().address;
    const usdcAddr = await env.usdc.getAddress();
    const oracleAddr = await oracle.getAddress();

    await harness.testSetMarket(
      market,
      ethers.Wallet.createRandom().address,
      50,
      1_000_000_000,
      1_000_000_000,
      500,
      1000,
      3600,
      200
    );
    await harness.setPosition(2, 500_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1, market);
    await harness.setCollateral(2, 2_000_000_000_000_000_000n);
    await oracle.setPrice(market, 100n * 10n ** 18n);
    await env.usdc.mintTo(await harness.getAddress(), 2_000_000_000n);

    await expect(harness.testWithdrawCollateral(2, 10_000_000_000n, usdcAddr, oracleAddr, 1000)).to.be.reverted;
    await harness.testWithdrawCollateral(2, 1_000_000n, usdcAddr, oracleAddr, 1000);
  });
});
