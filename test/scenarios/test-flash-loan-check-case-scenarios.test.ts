import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("FlashLoanCheck branch wave", function () {
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
    return { harness };
  }

  it("covers sender/origin/forwarder, per-block, code-size and delay branches", async function () {
    const { harness } = await loadFixture(deployHarnessFixture);
    const [, alice, bob] = await ethers.getSigners();

    // sender != origin and sender is not trusted forwarder
    await expect(harness.testValidateFlashLoan(alice.address, bob.address, true, 0, 0)).to.be.reverted;

    // trusted forwarder bypasses sender != origin check
    await harness.setTrustedForwarder(alice.address, true);
    await harness.testValidateFlashLoan(alice.address, bob.address, true, 0, 0);

    // same-block interaction via double call in one tx
    await expect(harness.testDoubleValidateFlashLoan(bob.address, bob.address, true, 0, 0)).to.be.reverted;

    // global per-block maxActions branch
    await expect(harness.testDoubleValidateFlashLoan(alice.address, alice.address, true, 1, 0)).to.be.reverted;

    // codeSize > 0 and !isOperator branch
    const receiver = await (await ethers.getContractFactory("MockERC721Receiver")).deploy();
    const c = await receiver.getAddress();
    await expect(harness.testValidateFlashLoan(c, c, false, 0, 0)).to.be.reverted;

    // minInteractionDelay branch
    const now = await time.latest();
    await harness.setLastInteractionTimestamp(alice.address, now);
    await expect(harness.testValidateFlashLoan(alice.address, alice.address, true, 0, 3600)).to.be.reverted;

    // Cover same-block global accounting without reverting on sender-level check.
    const s1 = ethers.Wallet.createRandom().address;
    const s2 = ethers.Wallet.createRandom().address;
    await harness.setTrustedForwarder(s1, true);
    await harness.setTrustedForwarder(s2, true);
    await harness.testDoubleValidateFlashLoanDifferentSenders(s1, s2, alice.address, true, 0, 0);
  });
});
