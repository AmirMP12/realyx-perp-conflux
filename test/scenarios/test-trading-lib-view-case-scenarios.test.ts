import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingLib view/owner branch wave", function () {
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

  it("covers pagination/active-position and owner-update branches", async function () {
    const { harness } = await loadFixture(deployHarnessFixture);
    const market = ethers.Wallet.createRandom().address;
    const receiver = await (await ethers.getContractFactory("MockERC721Receiver")).deploy();

    // pagination early-return branches
    const [empty0, total0] = await harness.testGetUserPositionsPaginated(0, 0);
    expect(empty0.length).to.equal(0);
    expect(total0).to.equal(0);

    await harness.addPositionId(1);
    await harness.addPositionId(2);
    await harness.addPositionId(3);

    const [page, total] = await harness.testGetUserPositionsPaginated(1, 2);
    expect(total).to.equal(3);
    expect(page.length).to.equal(2);

    const [empty1] = await harness.testGetUserPositionsPaginated(10, 1);
    expect(empty1.length).to.equal(0);

    // active position scan branches (OPEN vs non-OPEN)
    await harness.setPosition(1, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1, market);
    await harness.setPosition(2, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 0, market);
    await harness.setPosition(3, 1_000_000_000_000_000_000n, 100n * 10n ** 18n, 1, 1, market);
    const active = await harness.testGetActivePositions();
    expect(active.length).to.equal(2);

    // owner update guard branches
    await expect(harness.testUpdatePositionOwner(1, ethers.ZeroAddress, ethers.ZeroAddress, 1_000_000_000n)).to.be.reverted;
    await expect(
      harness.testUpdatePositionOwner(1, await receiver.getAddress(), ethers.ZeroAddress, 1_000_000_000n)
    ).to.be.reverted;
    await expect(
      harness.testUpdatePositionOwner(2, ethers.Wallet.createRandom().address, ethers.ZeroAddress, 1_000_000_000n)
    ).to.be.reverted;
    await expect(
      harness.testUpdatePositionOwner(1, ethers.Wallet.createRandom().address, ethers.ZeroAddress, 1)
    ).to.be.reverted;
    await harness.testUpdatePositionOwner(1, ethers.Wallet.createRandom().address, ethers.ZeroAddress, 1_000_000_000n);
  });
});
