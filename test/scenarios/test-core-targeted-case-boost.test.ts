import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Targeted Core Branch Boost", function () {
    async function fixture() {
        const env = await deployTestEnvironment();

        const TradingCoreViews = await ethers.getContractFactory("TradingCoreViews");
        const views = await TradingCoreViews.deploy();
        await views.initialize(
            await env.trading.getAddress(),
            await env.vault.getAddress(),
            await env.oracle.getAddress()
        );
        await env.trading.connect(env.admin).setTradingViews(await views.getAddress());

        return { env, views };
    }

    async function pushPrice(env: any, feedId: string, price: bigint, conf: bigint = 100n) {
        const now = await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId,
            price,
            conf,
            -8,
            price,
            conf,
            now,
            now
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    async function configureLiveMarket(env: any) {
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes(`MKT-${Date.now()}`));

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
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        return { market, feedId };
    }

    it("covers TradingCoreViews initialize guards", async function () {
        const { env } = await loadFixture(fixture);
        const TradingCoreViews = await ethers.getContractFactory("TradingCoreViews");
        const views = await TradingCoreViews.deploy();

        await expect(
            views.initialize(
                ethers.ZeroAddress,
                await env.vault.getAddress(),
                await env.oracle.getAddress()
            )
        ).to.be.reverted;

        await views.initialize(
            await env.trading.getAddress(),
            await env.vault.getAddress(),
            await env.oracle.getAddress()
        );
        await expect(
            views.initialize(
                await env.trading.getAddress(),
                await env.vault.getAddress(),
                await env.oracle.getAddress()
            )
        ).to.be.reverted;
        await expect(
            views.initialize(
                await env.trading.getAddress(),
                await env.vault.getAddress(),
                await env.oracle.getAddress()
            )
        ).to.be.reverted;

        const views2 = await TradingCoreViews.deploy();
        await expect(
            views2.initialize(
                await env.trading.getAddress(),
                ethers.ZeroAddress,
                await env.oracle.getAddress()
            )
        ).to.be.reverted;
        await expect(
            views2.initialize(
                await env.trading.getAddress(),
                await env.vault.getAddress(),
                ethers.ZeroAddress
            )
        ).to.be.reverted;
    });

    it("covers TradingCoreViews non-open and open position paths", async function () {
        const { env, views } = await loadFixture(fixture);
        const { market } = await configureLiveMarket(env);

        const closedHealth = await views.getPositionHealth(999);
        expect(closedHealth[0]).to.equal(false);
        expect(closedHealth[1]).to.equal((2n ** 256n) - 1n);

        await env.usdc.mintTo(env.alice.address, 20_000_000_000n);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, 100_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(10_000_000_000n, env.admin.address);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("500", 6),
            ethers.parseUnits("100", 6),
            0,
            true,
            0,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        await env.trading.connect(env.alice).setStopLoss(1, ethers.parseEther("90"));
        await env.trading.connect(env.alice).setTakeProfit(1, ethers.parseEther("120"));

        const openHealth = await views.getPositionHealth(1);
        expect(openHealth[3]).to.be.gt(0n);
    });

    it("covers TradingCoreViews short stop-loss/take-profit branches", async function () {
        const { env, views } = await loadFixture(fixture);
        const { market } = await configureLiveMarket(env);

        await env.usdc.mintTo(env.alice.address, 20_000_000_000n);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, 100_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(10_000_000_000n, env.admin.address);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("500", 6),
            ethers.parseUnits("100", 6),
            0,
            false,
            0,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        // For short: SL is price >= sl, TP is price <= tp
        await env.trading.connect(env.alice).setStopLoss(1, ethers.parseEther("110"));
        await env.trading.connect(env.alice).setTakeProfit(1, ethers.parseEther("90"));

        const h = await views.getPositionHealth(1);
        expect(h[3]).to.be.gt(0n);
    });

    it("covers TradingCoreViews non-open returns for getPositionPnL/canLiquidate", async function () {
        const { env, views } = await loadFixture(fixture);
        const pnl = await views.getPositionPnL(await env.trading.getAddress(), 999n);
        expect(pnl[0]).to.equal(0n);
        expect(pnl[1]).to.equal(0n);

        const liq = await views.canLiquidate(await env.trading.getAddress(), 999n);
        expect(liq[0]).to.equal(false);
        expect(liq[1]).to.equal((2n ** 256n) - 1n);
    });

    it("covers TradingCoreViews global PnL branches for zero-size and zero-price", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
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
        await env.trading.connect(env.admin).setMarketId(market, "VIEWS-0");
        await env.marketCalendar.connect(env.admin).setMarketConfig("VIEWS-0", 0, 1439, 0, true);

        const MockOracleZero = await ethers.getContractFactory("MockOracleZeroPrice");
        const mockOracle = await MockOracleZero.deploy();
        const TradingCoreViews = await ethers.getContractFactory("TradingCoreViews");
        const views = await TradingCoreViews.deploy();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await mockOracle.getAddress());

        // Active market with zero long/short size => `(m.totalLongSize > 0 || m.totalShortSize > 0)` false arm.
        await views.getGlobalUnrealizedPnL(await env.trading.getAddress());

        // Create a real open position so size condition is true, then zero-price oracle hits `if (price > 0)` false arm.
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("views-zero-price"));
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);
        await env.usdc.mintTo(env.alice.address, 20_000_000_000n);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, 100_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(10_000_000_000n, env.admin.address);
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("500", 6),
            ethers.parseUnits("100", 6),
            0,
            true,
            0,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);
        await views.getGlobalUnrealizedPnL(await env.trading.getAddress());
    });

    it("covers Oracle confidence/TWAP/breaker/status paths", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await configureLiveMarket(env);

        await pushPrice(env, feedId, 100n * 10n ** 8n, 80n * 10n ** 8n);
        await expect(env.oracle.getPriceWithConfidence(market, 1n)).to.be.reverted;

        await expect(env.oracle.getTWAPWithValidation(market, 3600, 5)).to.be.reverted;
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        const [twap, valid] = await env.oracle.getTWAPWithValidation(market, 3600, 5);
        expect(twap).to.be.gt(0n);
        expect(valid).to.equal(false);

        await env.oracle.configureBreaker(market, 0, 500, 3600, 60);
        await env.oracle.setBreakerEnabled(market, 0, true);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.triggerBreaker(market, 0);
        await env.oracle.resetBreaker(market, 0);

        const breakerStatus = await env.oracle.getBreakerStatus(market, 0);
        expect(breakerStatus).to.not.equal(undefined);
        const breakerConfig = await env.oracle.getBreakerConfig(market, 0);
        expect(breakerConfig.threshold).to.equal(500n);

        await env.oracle.activateGlobalPause();
        const [restricted] = await env.oracle.isMarketRestricted(market);
        expect(restricted).to.equal(true);
        await env.oracle.deactivateGlobalPause();

        const config = await env.oracle.getOracleConfig(market);
        expect(config[0]).to.equal(feedId);
        expect(await env.oracle.getGuardianQuorum()).to.be.gte(1n);
    });

    it("covers Oracle ETH feed and health branches", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("ETH-MARKET-BRANCH"));
        const ethFeedId = ethers.keccak256(ethers.toUtf8Bytes("ETH-USD-BRANCH"));

        expect(await env.oracle.getValidSourceCount(market)).to.equal(0n);
        const [healthyBefore, reasonBefore] = await env.oracle.isOracleHealthy(market);
        expect(healthyBefore).to.equal(false);
        expect(reasonBefore).to.equal("Not configured");

        await env.oracle.setPythFeed(market, feedId, 3600, 0);
        const [healthyAfter] = await env.oracle.isOracleHealthy(market);
        expect(healthyAfter).to.equal(false);
        expect(await env.oracle.getValidSourceCount(market)).to.equal(0n);

        await expect(env.oracle.getEthUsdPrice()).to.be.reverted;
        await env.oracle.setEthFeedId(ethFeedId);
        await pushPrice(env, ethFeedId, 2_000n * 10n ** 8n, 1n);
        const eth = await env.oracle.getEthUsdPrice();
        expect(eth).to.be.gt(0n);

        await env.oracle.configureBreaker(market, 0, 100, 3600, 1);
        await env.oracle.setBreakerEnabled(market, 0, true);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.triggerBreaker(market, 0);
        let restricted = await env.oracle.isMarketRestricted(market);
        expect(restricted[0]).to.equal(true);
        await time.increase(2);
        await env.oracle.autoResetBreakers(market);
        restricted = await env.oracle.isMarketRestricted(market);
        expect(restricted[1]).to.be.gte(0n);
    });

    it("covers OracleAggregator access-control and no-op setter branches", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("OAGG-ACCESS"));

        await expect(env.oracle.connect(env.alice).setEthFeedId(feedId)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).setMarketCalendar(await env.marketCalendar.getAddress())).to.be.reverted;
        await expect(env.oracle.connect(env.alice).setMarketId(market, "NOPE")).to.be.reverted;
        await expect(env.oracle.connect(env.alice).configureBreaker(market, 0, 100, 60, 60)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).setBreakerEnabled(market, 0, true)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).registerPausable(await env.trading.getAddress())).to.be.reverted;
        await expect(env.oracle.connect(env.alice).setGuardianQuorum(2)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).setEmergencyPriceQuorum(2)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).addSupportedMarket(market)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).proposeEmergencyPause([await env.trading.getAddress()], "x")).to.be.reverted;
        await expect(env.oracle.connect(env.alice).confirmEmergencyPause(ethers.ZeroHash)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).proposeEmergencyPrice(market, 1, 1)).to.be.reverted;
        await expect(env.oracle.connect(env.alice).confirmEmergencyPrice(ethers.ZeroHash)).to.be.reverted;

        // no-op arm when already unpaused
        await env.oracle.connect(env.admin).deactivateGlobalPause();

        // success arms for setters
        await env.oracle.connect(env.admin).setEthFeedId(feedId);
        await env.oracle.connect(env.admin).setMarketCalendar(await env.marketCalendar.getAddress());
        await env.oracle.connect(env.admin).setMarketId(market, "OK-MKT");
        await env.oracle.connect(env.admin).configureBreaker(market, 0, 100, 60, 60);
        await env.oracle.connect(env.admin).setBreakerEnabled(market, 0, true);
        await env.oracle.connect(env.admin).setGuardianQuorum(2);
        await env.oracle.connect(env.admin).setEmergencyPriceQuorum(2);
        await env.oracle.connect(env.admin).addSupportedMarket(market);

        // registerPausable only pushes once
        const target = await env.trading.getAddress();
        await env.oracle.connect(env.admin).registerPausable(target);
        const before = (await env.oracle.getPausableList()).length;
        await env.oracle.connect(env.admin).registerPausable(target);
        const after = (await env.oracle.getPausableList()).length;
        expect(after).to.equal(before);
    });

    it("covers TradingCore access control and guard branches", async function () {
        const { env } = await loadFixture(fixture);

        await expect(env.trading.connect(env.alice).setContracts(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress)).to.be.reverted;
        await expect(env.trading.connect(env.alice).setRWAContracts(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress)).to.be.reverted;
        await expect(env.trading.connect(env.alice).setMarketId(env.alice.address, "X")).to.be.reverted;
        await expect(env.trading.connect(env.alice).setMarket(env.alice.address, env.alice.address, 100, 1, 1, 500, 1000, 3600)).to.be.reverted;
        await expect(env.trading.connect(env.alice).updateMarket(env.alice.address, env.alice.address, 100, 1, 1, 500, 1000, 3600)).to.be.reverted;
        await expect(env.trading.connect(env.alice).unlistMarket(env.alice.address)).to.be.reverted;
        await expect(env.trading.connect(env.alice).setLimits(1, 1, 1, 1, 1, 1)).to.be.reverted;
        await expect(env.trading.connect(env.alice).setTrustedForwarder(ethers.ZeroAddress, true)).to.be.reverted;
        await expect(env.trading.connect(env.alice).setTradingViews(env.alice.address)).to.be.reverted;
        await expect(env.trading.connect(env.alice).sweepDust()).to.be.reverted;
        await expect(env.trading.connect(env.alice).setParams(1, 1, 1, 1, 1, 1, 1000)).to.be.reverted;

        await expect(env.trading.connect(env.alice).recordFailedRepayment(1, 1, env.alice.address, true, 0)).to.be.reverted;
        await expect(env.trading.connect(env.alice).liquidatePosition(1)).to.be.reverted;
        await expect(env.trading.connect(env.alice).resolveFailedRepayment(1)).to.be.reverted;
        await expect(env.trading.connect(env.alice).updatePositionOwner(1, env.alice.address, env.bob.address)).to.be.reverted;
        await expect(env.trading.connect(env.alice).updateProtocolHealth()).to.be.reverted;
        await expect(env.trading.connect(env.alice).executeStopLossTakeProfit([1])).to.be.reverted;

        // tradingViews guards
        await env.trading.connect(env.admin).setTradingViews(ethers.ZeroAddress);
        await expect(env.trading.getPositionPnL(1)).to.be.reverted;
        await expect(env.trading.canLiquidate(1)).to.be.reverted;
        await expect(env.trading.getGlobalUnrealizedPnL()).to.be.reverted;

        // deadline / owner / position-state guards
        const now = await time.latest();
        await expect(env.trading.connect(env.alice).closePosition([1n, 0n, 0n, BigInt(now - 1)])).to.be.reverted;
        await expect(env.trading.connect(env.alice).partialClose(1n, 10n ** 18n, 0n, BigInt(now - 1))).to.be.reverted;
        await expect(env.trading.connect(env.alice).addCollateral(1n, 1n, 0n, false)).to.be.reverted;
        await expect(env.trading.connect(env.alice).withdrawCollateral(1n, 1n)).to.be.reverted;

        // cleanup unauthorized and authorized paths
        await expect(env.trading.connect(env.alice).cleanupPositions(env.bob.address, 1)).to.be.reverted;
        await env.trading.connect(env.admin).cleanupPositions(env.admin.address, 1);
    });

    it("covers TradingCore breaker/compliance/owner additional branches", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TC-BR-EXTRA"));
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));

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
        await env.trading.connect(env.admin).setMarketId(market, "TC-BR");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TC-BR", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);

        // checkCompliance false-arm: disable compliance manager and create order successfully.
        await env.trading.connect(env.admin).setRWAContracts(
            await env.marketCalendar.getAddress(),
            await env.dividendManager.getAddress(),
            ethers.ZeroAddress
        );
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        // checkBreakersForOrder true-arm: breaker active blocks increase-order execution.
        await env.oracle.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.connect(env.admin).configureBreaker(market, 0, 100, 60, 60);
        await env.oracle.connect(env.admin).setBreakerEnabled(market, 0, true);
        await env.oracle.connect(env.admin).triggerBreaker(market, 0);
        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.reverted;

        // clear breaker then execute and hit _validateOwner owner-success branch via addCollateral.
        await env.oracle.connect(env.admin).resetBreaker(market, 0);
        await env.trading.connect(env.keeper).executeOrder(1n, []);
        await env.trading.connect(env.alice).addCollateral(1n, ethers.parseUnits("10", 6), 0n, false);
    });

    it("covers TradingLib cancelOrder branches (notfound/unauthorized/refunds)", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-CANCEL"));

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-CANCEL");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-CANCEL", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("10000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        await expect(env.trading.connect(env.alice).cancelOrder(777n)).to.be.reverted;

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await expect(env.trading.connect(env.bob).cancelOrder(1n)).to.be.reverted;
        await env.trading.connect(env.alice).cancelOrder(1n);
    });

    it("covers TradingLib SL/TP dividend settlement branch with non-zero dividend", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-SLTP-DIV"));

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-SLTP-DIV");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-SLTP-DIV", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);

        const MockDiv = await ethers.getContractFactory("MockDividendManagerConfigurable");
        const mockDiv = await MockDiv.deploy();
        await mockDiv.setSettleResult(ethers.parseEther("1"), 1n);
        await env.trading.connect(env.admin).setRWAContracts(
            await env.marketCalendar.getAddress(),
            await mockDiv.getAddress(),
            await env.complianceManager.getAddress()
        );

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1n, []);
        await env.trading.connect(env.alice).setStopLoss(1n, ethers.parseEther("95"));
        await time.increase(130);
        await pushPrice(env, feedId, 90n * 10n ** 8n);
        await env.usdc.mintTo(await env.trading.getAddress(), ethers.parseUnits("50000", 6));
        await env.trading.connect(env.keeper).executeStopLossTakeProfit([1n]);
    });

    it("covers TradingLib resolveFailedRepayment success and failure branches", async function () {
        const { env } = await loadFixture(fixture);
        const TRADING_CORE_ROLE = await env.trading.TRADING_CORE_ROLE();

        await env.trading.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);

        // Success path with needFromSender > 0.
        await env.trading.connect(env.admin).recordFailedRepayment(9001n, ethers.parseUnits("100", 6), env.alice.address, true, 0);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("1000", 6));
        await env.usdc.connect(env.admin).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.trading.connect(env.admin).resolveFailedRepayment(9001n);

        // Invalid/resolved guard arm.
        await expect(env.trading.connect(env.admin).resolveFailedRepayment(9001n)).to.be.reverted;

        // Failure path: vault repay reverts -> refund + RepaymentValidationFailed.
        await env.trading.connect(env.admin).recordFailedRepayment(9002n, ethers.parseUnits("50", 6), env.alice.address, true, 0);
        const MockVault = await ethers.getContractFactory("MockVaultRevertingRepay");
        const badVault = await MockVault.deploy();
        await env.trading
            .connect(env.admin)
            .setContracts(await badVault.getAddress(), await env.oracle.getAddress(), await env.positionToken.getAddress());
        await expect(env.trading.connect(env.admin).resolveFailedRepayment(9002n)).to.be.reverted;
    });

    it("covers TradingLib _executeDecrease invalid LIMIT_DECREASE trigger branch", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-LIMIT-DEC-INV"));

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-LIMIT-DEC");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-LIMIT-DEC", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        // LIMIT_DECREASE with trigger above current for long should revert InvalidOrder in _executeDecrease.
        await env.trading.connect(env.alice).createOrder(
            3,
            market,
            ethers.parseUnits("200", 6),
            0,
            ethers.parseUnits("110", 18),
            true,
            10000,
            1n,
            { value: ethers.parseEther("0.01") }
        );
        await expect(env.trading.connect(env.keeper).executeOrder(2n, [])).to.be.reverted;
    });

    it("covers TradingLib _executeIncrease borrow-failed and close wrapper ownerOf-catch branches", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-BORROW-FAIL"));

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-BORROW-FAIL");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-BORROW-FAIL", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        // No vault liquidity deposit: borrow() should return false and _executeIncrease reverts InsufficientLiquidity.
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.reverted;

        // Build a real open position, then swap position token to one that reverts ownerOf.
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(2n, []);

        const MockPT = await ethers.getContractFactory("MockPositionTokenRevertOwner");
        const badPT = await MockPT.deploy();
        await env.trading
            .connect(env.admin)
            .setContracts(await env.vault.getAddress(), await env.oracle.getAddress(), await badPT.getAddress());
        const blk = await ethers.provider.getBlock("latest");
        await expect(
            env.trading.connect(env.alice).closePosition([1n, ethers.parseUnits("1200", 6), 0n, BigInt(blk!.timestamp + 600)])
        ).to.be.reverted;
    });

    it("covers TradingLib _executeIncrease OpenPriceDeviation (spot vs TWAP)", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-TWAP-DEV"));
        const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-TWAP-DEV");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-TWAP-DEV", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);

        const ORACLE_KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
        await env.oracle.grantRole(ORACLE_KEEPER_ROLE, env.admin.address);

        for (let i = 0; i < 6; i++) {
            await pushPrice(env, feedId, 90n * 10n ** 8n);
            if (i > 0) {
                await time.increase(301);
            }
            await env.oracle.connect(env.admin).recordPricePoint(market, 0);
        }

        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.revertedWithCustomError(
            tradingLib,
            "OpenPriceDeviation"
        );
    });

    it("covers TradingLib _executeIncrease OpenPriceDeviation when TWAP exceeds spot", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-TWAP-ABOVE"));
        const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-TWAP-ABOVE");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-TWAP-ABOVE", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);

        const ORACLE_KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
        await env.oracle.grantRole(ORACLE_KEEPER_ROLE, env.admin.address);

        for (let i = 0; i < 6; i++) {
            await pushPrice(env, feedId, 110n * 10n ** 8n);
            if (i > 0) {
                await time.increase(301);
            }
            await env.oracle.connect(env.admin).recordPricePoint(market, 0);
        }

        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            0,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.revertedWithCustomError(
            tradingLib,
            "OpenPriceDeviation"
        );
    });

    it("covers TradingLib _executeIncrease SlippageExceeded on MARKET_INCREASE with trigger", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-MKT-TRIG-SLIP"));
        const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-MKT-TRIG");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-MKT-TRIG", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);

        const trigger = 85n * 10n ** 18n;
        const maxSlippage = 500n;
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            trigger,
            true,
            maxSlippage,
            0,
            { value: ethers.parseEther("0.01") }
        );

        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.revertedWithCustomError(
            tradingLib,
            "SlippageExceeded"
        );
    });

    it("covers TradingLib executeOrderFull InvalidOrder on LIMIT_INCREASE trigger vs spot", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-LIMIT-INV"));
        const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-LIMIT-INV");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-LIMIT-INV", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 110n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        const trigger = 100n * 10n ** 18n;
        await env.trading.connect(env.alice).createOrder(
            2,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            trigger,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.revertedWithCustomError(
            tradingLib,
            "InvalidOrder"
        );
    });

    it("covers TradingLib executeOrderFull InvalidOrder on LIMIT_INCREASE short when spot below trigger", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-LIMIT-SHORT-INV"));
        const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-LIM-SH");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-LIM-SH", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 90n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        const trigger = 100n * 10n ** 18n;
        await env.trading.connect(env.alice).createOrder(
            2,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            trigger,
            false,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.revertedWithCustomError(
            tradingLib,
            "InvalidOrder"
        );
    });

    it("covers TradingLib _executeIncrease slippage when maxSlippage is zero (executeOrderFull skips early check)", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("TL-MKT-ZSLIP"));
        const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);

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
        await env.trading.connect(env.admin).setMarketId(market, "TL-MKT-ZSLIP");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TL-MKT-ZSLIP", 0, 1439, 0, true);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("300000", 6), env.admin.address);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("400", 6),
            85n * 10n ** 18n,
            true,
            0,
            0,
            { value: ethers.parseEther("0.01") }
        );

        await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.revertedWithCustomError(
            tradingLib,
            "SlippageExceeded"
        );
    });

});
