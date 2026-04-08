import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingLib funding wrappers via CoverageHarness", function () {
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

  it("covers settleFunding and settlePositionFunding wrapper paths", async function () {
    const { harness } = await loadFixture(deployHarnessFixture);
    const oracle = await ethers.deployContract("MockOracleSimple");

    const market = ethers.Wallet.createRandom().address;
    await harness.testSetMarket(
      market,
      ethers.Wallet.createRandom().address,
      20,
      1_000_000,
      1_000_000,
      500,
      1000,
      3600,
      200
    );

    // Wrapper line for TradingLib.settleFunding
    await harness.setFundingState(market, 0, 0, 0, 0, 0);
    await harness.testTradingLibSettleFunding(market);
    await time.increase(8 * 3600);
    await harness.testTradingLibSettleFunding(market);

    // Revert branch: non-open position through TradingLib -> FundingLib
    const id = 901n;
    await harness.setPosition(id, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 0, market);
    await harness.setCollateral(id, 1_000_000n);
    await expect(harness.testTradingLibSettlePositionFunding(id, await oracle.getAddress())).to.be.reverted;

    // Success branch with open position and oracle price available.
    await harness.setPosition(id, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1, market);
    await oracle.setPrice(market, 100n * 10n ** 18n);
    await harness.setPositionCumulativeFunding(id, 0);
    await harness.setFundingState(market, 0, 1_000, 1, 1_000_000_000_000_000_000n, 1_000_000_000_000_000_000n);
    await harness.testTradingLibSettlePositionFunding(id, await oracle.getAddress());
  });

  it("covers executeOrder invalid order type revert", async function () {
    const { harness } = await loadFixture(deployHarnessFixture);
    await expect(harness.testTradingLibExecuteOrderInvalidType(99)).to.be.reverted;
  });
});
