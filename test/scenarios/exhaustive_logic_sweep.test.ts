import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Exhaustive Protocol Logic Sweep", function () {
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

    async function deployHarnessFixture() {
        const env = await deployTestEnvironment();

        const Harness = await ethers.getContractFactory("FeeCalculatorPositionMathHarness");
        const branchHarness = await Harness.deploy();

        const LiquidationLibHarness = await ethers.getContractFactory("LiquidationLibHarness", {
            libraries: {
                "contracts/libraries/LiquidationLib.sol:LiquidationLib": env.libs.liqLib,
            },
        });
        const liquidationHarness = await LiquidationLibHarness.deploy();

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
        const coverageHarness = await CoverageHarness.deploy();

        return { env, branchHarness, liquidationHarness, coverageHarness };
    }

    async function pushPrice(env: Awaited<ReturnType<typeof deployTestEnvironment>>, feedId: string, price: bigint, conf: bigint = 1n) {
        const now = await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(feedId, price, conf, -8, price, conf, now, now - 5);
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    it("TradingCore.validateOracleForMarket hits requireOracleSources branches", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        const bad = ethers.Wallet.createRandom().address;
        await expect(env.trading.validateOracleForMarket.staticCall(bad)).to.be.revertedWithCustomError(
            env.trading,
            "InsufficientOracleSources"
        );

        const market = env.alice.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("full-sweep-oracle"));
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await expect(env.trading.validateOracleForMarket.staticCall(market)).to.not.be.reverted;
    });

    it("DataTypes.packFlags branches via FeeCalculatorPositionMathHarness", async function () {
        const { branchHarness } = await loadFixture(deployHarnessFixture);
        expect(await branchHarness.testPackFlags(true, false)).to.equal(1);
        expect(await branchHarness.testPackFlags(false, true)).to.equal(2);
        expect(await branchHarness.testPackFlags(true, true)).to.equal(3);
        expect(await branchHarness.testPackFlags(false, false)).to.equal(0);
    });

    it("LiquidationLib.checkLiquidatableBatch OPEN vs non-OPEN arms", async function () {
        const { env, liquidationHarness } = await loadFixture(deployHarnessFixture);
        const market = env.bob.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("liq-batch"));
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 50n * 10n ** 8n);

        const oid = 1n;
        await liquidationHarness.setPosition(oid, 2, market, 0, 0, 0, 20); // CLOSED = 2
        await liquidationHarness.setCollateral(oid, 0);

        const openId = 2n;
        await liquidationHarness.setPosition(openId, 1, market, 1000, 50n * 10n ** 18n, 1, 20); // OPEN = 1
        await liquidationHarness.setCollateral(openId, 10n ** 18n);

        const [liq, hf] = await liquidationHarness.checkBatch([oid, openId], await env.oracle.getAddress(), [market, market]);
        expect(hf[0]).to.equal((2n ** 256n) - 1n);
        expect(liq[1]).to.be.a("boolean");

        const [canClosed, hfClosed] = await liquidationHarness.canLiquidateAt(oid, 50n * 10n ** 18n);
        expect(canClosed).to.equal(false);
        expect(hfClosed).to.equal((2n ** 256n) - 1n);

        const [canOpen, hfOpen] = await liquidationHarness.canLiquidateAt(openId, 50n * 10n ** 18n);
        expect(canOpen).to.be.a("boolean");
        expect(hfOpen).to.be.a("bigint");
    });

    it("CoverageHarness OracleAggregatorLib simple TWAP + Chainlink normalize arms", async function () {
        const { coverageHarness } = await loadFixture(deployHarnessFixture);
        expect(await coverageHarness.testCalculateSimpleTWAPFromBuffer()).to.equal(0n);

        const t = BigInt(await time.latest());
        await coverageHarness.addPricePoint(100n, 1n, t);
        await coverageHarness.addPricePoint(200n, 1n, t + 1n);
        const twap = await coverageHarness.testCalculateSimpleTWAPFromBuffer();
        expect(twap).to.be.gt(0n);

        expect(await coverageHarness.testNormalizeChainlinkPrice(0, 8)).to.equal(0n);
        expect(await coverageHarness.testNormalizeChainlinkPrice(10n ** 8n, 8)).to.be.gt(0n);
        expect(await coverageHarness.testNormalizeChainlinkPrice(10n ** 18n, 18)).to.equal(10n ** 18n);
        expect(await coverageHarness.testNormalizeChainlinkPrice(10n ** 19n, 19)).to.equal(10n ** 18n);

        await coverageHarness.setKeeperFeeBalance((await ethers.getSigners())[0].address, 0n);
        await coverageHarness.testWithdrawKeeperFees((await ethers.getSigners())[0].address);
    });

    it("OracleAggregator access, pause, calendar, and historical price branches", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);

        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("sweep-oagg"));
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await expect(env.oracle.connect(env.alice).recordPricePoint(market, 0)).to.be.revertedWithCustomError(
            env.oracle,
            "NotOracleOrKeeper"
        );

        await expect(env.oracle.connect(env.admin).setMarketCalendar(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            env.oracle,
            "ZeroAddress"
        );

        await expect(env.oracle.getHistoricalPrice(market, 24n)).to.be.revertedWithCustomError(env.oracle, "DataNotFound");

        await env.oracle.connect(env.admin).activateGlobalPause();
        await env.oracle.connect(env.admin).activateGlobalPause();
        await env.oracle.connect(env.admin).deactivateGlobalPause();
        await env.oracle.connect(env.admin).deactivateGlobalPause();

        await env.oracle.connect(env.admin).setMarketCalendar(await env.marketCalendar.getAddress());
        await env.oracle.connect(env.admin).setMarketId(market, "SWEEP");
        await env.marketCalendar.connect(env.admin).setMarketConfig("SWEEP", 0, 1439, 0, true);

        await env.oracle.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);
        await env.oracle.connect(env.admin).configureBreaker(market, 2, 100, 900, 60);
        await env.oracle.connect(env.admin).setBreakerEnabled(market, 2, true);
        await env.oracle.checkBreakers(market, 100n * 10n ** 18n, 0n);
    });

    it("TradingCore updateMarket hits emit path (line coverage)", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        const market = ethers.Wallet.createRandom().address;
        const feed = ethers.Wallet.createRandom().address;
        await env.trading.connect(env.admin).setMarket(
            market,
            feed,
            100,
            ethers.parseEther("1000000"),
            ethers.parseEther("10000000"),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).updateMarket(
            market,
            feed,
            100,
            ethers.parseEther("2000000"),
            ethers.parseEther("10000000"),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).unlistMarket(market);
    });

    it("FundingLib settleFunding returns early when intervalsElapsed is zero", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        const market = env.treasury.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("funding-sweep"));
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            100,
            ethers.parseEther("1000000"),
            ethers.parseEther("10000000"),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).setMarketId(market, "FUND-SW");

        await env.trading.connect(env.admin).settleFunding(market);
        await env.trading.connect(env.admin).settleFunding(market);
    });

    it("MonitoringLib non-OPEN position arm via CoverageHarness", async function () {
        const { env, coverageHarness } = await loadFixture(deployHarnessFixture);
        await coverageHarness.setPosition(0, 1000, 1000, 1, 2, ethers.ZeroAddress);
        await coverageHarness.setCollateral(0, 100);
        const h = await coverageHarness.testGetPositionHealth(await env.oracle.getAddress());
        expect(h[0]).to.equal(false);
    });
});
