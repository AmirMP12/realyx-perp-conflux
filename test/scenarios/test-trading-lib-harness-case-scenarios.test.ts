import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingLib Harness Branch Wave", function () {
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

        return { env, harness };
    }

    it("covers TradingLib pagination and active-position branches", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);

        let res = await harness.testGetUserPositionsPaginated(0, 10);
        expect(res[1]).to.equal(0n);

        await harness.addPositionId(1);
        await harness.addPositionId(2);
        await harness.addPositionId(3);

        res = await harness.testGetUserPositionsPaginated(5, 2);
        expect(res[0].length).to.equal(0);

        res = await harness.testGetUserPositionsPaginated(0, 2);
        expect(res[0].length).to.equal(2);
        expect(res[1]).to.equal(3n);

        // enum PosStatus: NONE=0, OPEN=1, CLOSED=2
        await harness.setPosition(1, 1000, 1000, 1, 1, ethers.ZeroAddress);
        await harness.setPosition(2, 1000, 1000, 1, 2, ethers.ZeroAddress);
        await harness.setPosition(3, 1000, 1000, 0, 1, ethers.ZeroAddress);
        const active = await harness.testGetActivePositions();
        expect(active.length).to.be.gte(1);
    });

    it("covers TradingLib volume and ownership branches", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);
        const [ownerA, ownerB] = await ethers.getSigners();

        expect(await harness.testCheckVolumeLimit(ownerA.address, 10, 0, 0)).to.equal(false);
        expect(await harness.testCheckVolumeLimit(ownerA.address, 10, 1000, 1000)).to.equal(true);

        await harness.testUpdateVolume(ownerA.address, 500);
        await harness.testUpdateVolume(ownerA.address, 250);

        await harness.setPosition(7, 1000, 1000, 1, 1, ethers.ZeroAddress);
        await harness.testUpdatePositionOwner(7, ownerB.address, ownerA.address, 1);
        await harness.testUpdatePositionOwner(7, ownerA.address, ownerB.address, ethers.MaxUint256);
    });

    it("covers TradingLib market-open and collateral error branches", async function () {
        const { harness, env } = await loadFixture(deployHarnessFixture);
        const market = await env.usdc.getAddress();

        await harness.setMarketId(market, "BTC-USD");
        expect(await harness.testCheckMarketOpen(market, await env.marketCalendar.getAddress())).to.equal(true);

        // Unknown market id path or non-calendar target path
        await expect(
            harness.testCheckMarketOpen(market, await env.usdc.getAddress())
        ).to.be.reverted;

        await harness.setPosition(10, 1000, 1000, 1, 1, market);
        await harness.setCollateral(10, 100);
        await expect(
            harness.testAddCollateral(10, 50, 1, false, await env.usdc.getAddress(), ethers.ZeroAddress, 0)
        ).to.be.reverted;
        await expect(
            harness.testWithdrawCollateral(10, 10, await env.usdc.getAddress(), ethers.ZeroAddress, 0)
        ).to.be.reverted;
    });
});
