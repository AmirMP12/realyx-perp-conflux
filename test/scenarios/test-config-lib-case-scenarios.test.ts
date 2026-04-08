import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("ConfigLib Branch Wave", function () {
    async function deployHarnessFixture() {
        const env = await deployTestEnvironment();

        const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
            libraries: {
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
            }
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
            }
        });
        const harness = await CoverageHarness.deploy();
        return { harness };
    }

    it("covers set/update validation branches", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);

        const m = ethers.Wallet.createRandom().address;
        const feed = ethers.Wallet.createRandom().address;

        await expect(
            harness.testSetMarket(ethers.ZeroAddress, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0)
        ).to.be.reverted;
        await expect(
            harness.testSetMarket(m, ethers.ZeroAddress, 50, 1_000, 10_000, 500, 1_000, 3600, 0)
        ).to.be.reverted;
        await expect(
            harness.testSetMarket(m, feed, 501, 1_000, 10_000, 500, 1_000, 3600, 0)
        ).to.be.reverted;
        await expect(
            harness.testSetMarket(m, feed, 50, 1_000, 10_000, 50, 1_000, 3600, 0)
        ).to.be.reverted;

        await harness.testSetMarket(m, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0);
        await expect(
            harness.testSetMarket(m, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0)
        ).to.be.reverted;

        await expect(
            harness.testUpdateMarket(ethers.Wallet.createRandom().address, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0)
        ).to.be.reverted;
    });

    it("covers max active markets and unlist loop branches", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);

        const markets: string[] = [];
        for (let i = 0; i < 20; i++) {
            const m = ethers.Wallet.createRandom().address;
            markets.push(m);
            await harness.testSetMarket(
                m,
                ethers.Wallet.createRandom().address,
                50,
                1_000 + i,
                10_000 + i,
                500,
                1_000,
                3600,
                0
            );
        }

        await expect(
            harness.testSetMarket(
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address,
                50,
                2_000,
                20_000,
                500,
                1_000,
                3600,
                0
            )
        ).to.be.reverted;

        // Unlist a middle entry to exercise the for-loop scan branch.
        await harness.setUnlistMarket(markets[10]);
        await expect(harness.setUnlistMarket(markets[10])).to.be.reverted;
    });

    it("covers ConfigLib margin short-circuit branches and setMarket else on isMarketActive", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);
        const m = ethers.Wallet.createRandom().address;
        const feed = ethers.Wallet.createRandom().address;

        await expect(
            harness.testSetMarket(m, feed, 50, 1_000, 10_000, 50, 1_000, 3600, 0)
        ).to.be.reverted;
        await expect(
            harness.testSetMarket(m, feed, 50, 1_000, 10_000, 5001, 1_000, 3600, 0)
        ).to.be.reverted;
        await expect(
            harness.testSetMarket(m, feed, 50, 1_000, 10_000, 500, 199, 3600, 0)
        ).to.be.reverted;
        await expect(
            harness.testSetMarket(m, feed, 50, 1_000, 10_000, 500, 10001, 3600, 0)
        ).to.be.reverted;
        await expect(
            harness.testSetMarket(m, feed, 50, 1_000, 10_000, 600, 500, 3600, 0)
        ).to.be.reverted;

        await harness.testSetMarket(m, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0);
        await harness.setUnlistMarket(m);
        await harness.corruptIsMarketActive(m, true);
        await harness.testSetMarket(
            m,
            feed,
            50,
            1_000,
            10_000,
            500,
            1_000,
            3600,
            0
        );

        await expect(harness.testUpdateMarket(m, ethers.ZeroAddress, 50, 1_000, 10_000, 500, 1_000, 3600, 0)).to.be.reverted;
        await expect(harness.testUpdateMarket(ethers.ZeroAddress, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0)).to.be.reverted;

        const m2 = ethers.Wallet.createRandom().address;
        const f2 = ethers.Wallet.createRandom().address;
        await harness.testSetMarket(m2, f2, 50, 1_000, 10_000, 500, 1_000, 3600, 0);
        await harness.corruptIsMarketActive(m2, false);
        await harness.setUnlistMarket(m2);
    });
});
