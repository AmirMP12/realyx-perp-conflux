import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Coverage branch boost toward 80% on remaining files", function () {
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));

    async function covHarness() {
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
        return { env, harness: await CoverageHarness.deploy() };
    }

    it("WithdrawLib withdrawKeeperFees hits TransferFailed when receiver rejects ETH", async function () {
        const { harness } = await loadFixture(covHarness);
        const reject = await (await ethers.getContractFactory("MockRejectEthReceiver")).deploy();
        await reject.getAddress();
        await harness.setKeeperFeeBalance(await reject.getAddress(), 1n);
        await expect(harness.testWithdrawKeeperFees(await reject.getAddress())).to.be.reverted;
    });

    it("TradingCoreViews.getCircuitBreakerStatus with global pause and breaker restricted", async function () {
        const env = await deployTestEnvironment();
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        const market = env.alice.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("views-brk"));
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        const now = await time.latest();
        const u = await env.pyth.createPriceFeedUpdateData(feedId, 100n * 10n ** 8n, 1n, -8, 100n * 10n ** 8n, 1n, now, now - 5);
        await env.pyth.updatePriceFeeds([u], { value: 1 });

        const Views = await ethers.getContractFactory("TradingCoreViews");
        const views = await Views.deploy();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());

        await env.oracle.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.connect(env.admin).configureBreaker(market, 0, 100, 3600, 60);
        await env.oracle.connect(env.admin).setBreakerEnabled(market, 0, true);
        await env.oracle.connect(env.admin).triggerBreaker(market, 0);

        await env.oracle.connect(env.admin).activateGlobalPause();
        const st = await views.getCircuitBreakerStatus(market);
        expect(st[2]).to.equal(true);
        await env.oracle.connect(env.admin).deactivateGlobalPause();
        await env.oracle.connect(env.admin).resetBreaker(market, 0);
    });

    it("TradingCoreViews.getGlobalUnrealizedPnL with inactive and zero-price skips", async function () {
        const env = await deployTestEnvironment();
        const mInactive = ethers.Wallet.createRandom().address;
        await env.trading.connect(env.admin).setMarket(
            mInactive,
            mInactive,
            50,
            ethers.parseEther("1"),
            ethers.parseEther("10"),
            500,
            1000,
            36000
        );

        const Views = await ethers.getContractFactory("TradingCoreViews");
        const views = await Views.deploy();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());
        await views.getGlobalUnrealizedPnL(await env.trading.getAddress());
    });

    it("ConfigLib updateMarket boundary margins", async function () {
        const { harness } = await loadFixture(covHarness);
        const m = ethers.Wallet.createRandom().address;
        const f = ethers.Wallet.createRandom().address;
        await harness.testSetMarket(m, f, 50, 1000, 10000, 500, 1000, 3600, 0);
        await harness.testUpdateMarket(m, f, 50, 1000, 10000, 5000, 10000, 3600, 0);
        await expect(harness.testUpdateMarket(m, f, 50, 1000, 10000, 5000, 500, 3600, 0)).to.be.reverted;
    });

    it("VaultCore totalAssets with trading wired and positive global PnL liability branch", async function () {
        const env = await deployTestEnvironment();
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("vault-pnl"));
        const market = env.alice.address;
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
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
        await env.trading.connect(env.admin).setMarketId(market, "V-PNL");
        await env.marketCalendar.connect(env.admin).setMarketConfig("V-PNL", 0, 1439, 0, true);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("50000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.bob.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("200000", 6), env.bob.address);

        const px = 3000n * 10n ** 8n;
        const t = await time.latest();
        const u = await env.pyth.createPriceFeedUpdateData(feedId, px, 1n, -8, px, 1n, t, t - 5);
        await env.pyth.updatePriceFeeds([u], { value: 1 });

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("10000", 6),
            ethers.parseUnits("2000", 6),
            ethers.parseUnits("3000", 18),
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        const Views = await ethers.getContractFactory("TradingCoreViews");
        const views = await Views.deploy();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());
        await env.trading.connect(env.admin).setTradingViews(await views.getAddress());

        const px2 = 5000n * 10n ** 8n;
        const u2 = await env.pyth.createPriceFeedUpdateData(feedId, px2, 1n, -8, px2, 1n, t + 100, t + 95);
        await env.pyth.updatePriceFeeds([u2], { value: 1 });
        await env.vault.totalAssets();
    });
});
