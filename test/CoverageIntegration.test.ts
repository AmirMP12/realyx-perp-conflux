import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "./helpers";

describe("Coverage Integration - Admin & Protocol Operations", function () {
    let env: any;
    const MARKET = "0x0000000000000000000000000000000000000001";
    const MARKET_ID = "ETH-USD";
    const PYTH_ID = ethers.keccak256(ethers.toUtf8Bytes("ETH/USD"));

    beforeEach(async () => {
        env = await deployTestEnvironment();
        await env.oracle.connect(env.admin).setPythFeed(MARKET, PYTH_ID, 3600, ethers.parseUnits("10", 18));
        await env.oracle.connect(env.admin).addSupportedMarket(MARKET);
        await env.marketCalendar.connect(env.admin).setMarketConfig(MARKET_ID, 0, 1439, 0, true);
        await env.trading.connect(env.admin).setMarket(
            MARKET, MARKET, 50,
            ethers.parseUnits("1000000", 18), ethers.parseUnits("10000000", 18),
            500, 1000, 3600
        );
        await env.trading.connect(env.admin).setMarketId(MARKET, MARKET_ID);
    });

    async function feedPrice(price: number) {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        const payload = await env.pyth.createPriceFeedUpdateData(
            PYTH_ID, price * 1e8, 1, -8, price * 1e8, 1, publishTime, publishTime - 5
        );
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
    }

    async function setupPositionWithLP() {
        await feedPrice(3000);
        const bob = ethers.parseUnits("1000000", 6);
        await env.usdc.connect(env.admin).mintTo(env.bob.address, bob);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(bob, env.bob.address);

        const alice = ethers.parseUnits("10000", 6);
        await env.usdc.connect(env.admin).mintTo(env.alice.address, alice);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        await env.trading.connect(env.alice).createOrder(
            0, MARKET, ethers.parseUnits("3000", 6), ethers.parseUnits("300", 18),
            ethers.parseUnits("3000", 18), true, 10000, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, [], { value: 0 });
    }

    describe("OracleAggregator Coverage", function () {
        it("should handle TWAP recording and reading", async function () {
            await feedPrice(3000);
            const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
            await env.oracle.grantRole(KEEPER_ROLE, env.keeper.address);
            await env.oracle.connect(env.keeper).recordPricePoint(MARKET, 0);
            await env.oracle.getTWAP(MARKET, 300);
            const [price] = await env.oracle.getPrice(MARKET);
            expect(price).to.be.gt(0);
            const [healthy] = await env.oracle.isOracleHealthy(MARKET);
            expect(healthy).to.be.true;
            expect(await env.oracle.getValidSourceCount(MARKET)).to.equal(1);
            expect(await env.oracle.isActionAllowed(MARKET, 0)).to.be.true;
            await env.oracle.connect(env.admin).setMarketId(MARKET, MARKET_ID);
        });

        it("should handle circuit breaker configuration", async function () {
            await env.oracle.connect(env.admin).configureBreaker(MARKET, 0, 1000, 300, 60);
            await env.oracle.connect(env.admin).configureBreaker(MARKET, 1, 2000, 600, 120);
            await env.oracle.connect(env.admin).configureBreaker(MARKET, 2, 500, 300, 60);
            await feedPrice(3000);
            await env.oracle.autoResetBreakers(MARKET);
        });

        it("should handle global pause/unpause", async function () {
            const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
            await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
            await env.oracle.connect(env.admin).activateGlobalPause();
            expect(await env.oracle.isGloballyPaused()).to.be.true;
            await env.oracle.connect(env.admin).deactivateGlobalPause();
            expect(await env.oracle.isGloballyPaused()).to.be.false;
        });

        it("should handle ETH feed and guardian quorum", async function () {
            await env.oracle.connect(env.admin).setEthFeedId(ethers.keccak256(ethers.toUtf8Bytes("ETH")));
            await env.oracle.connect(env.admin).setGuardianQuorum(3);
        });

        it("should handle emergency price proposals", async function () {
            const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
            await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
            await env.oracle.connect(env.admin).setGuardianQuorum(1);
            await env.oracle.connect(env.admin).proposeEmergencyPrice(
                MARKET, ethers.parseUnits("3000", 18), Math.floor(Date.now() / 1000) + 3600
            );
        });

        it("should handle market calendar setting", async function () {
            await env.oracle.connect(env.admin).setMarketCalendar(await env.marketCalendar.getAddress());
        });

        it("should report unhealthy for unconfigured market", async function () {
            const FAKE = "0x0000000000000000000000000000000000000099";
            const [healthy, reason] = await env.oracle.isOracleHealthy(FAKE);
            expect(healthy).to.be.false;
            expect(reason).to.equal("Not configured");
        });
    });

    describe("VaultCore Coverage", function () {
        it("should handle deposit", async function () {
            const amount = ethers.parseUnits("1000", 6);
            await env.usdc.connect(env.admin).mintTo(env.bob.address, amount);
            await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
            await env.vault.connect(env.bob).deposit(amount, env.bob.address);
            expect(await env.vault.totalAssets()).to.be.gt(0);
        });

        it("should handle vault admin functions", async function () {
            await env.vault.connect(env.admin).setTreasury(env.treasury.address);
        });

        it("should handle vault utilization", async function () {
            const amount = ethers.parseUnits("1000000", 6);
            await env.usdc.connect(env.admin).mintTo(env.bob.address, amount);
            await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
            await env.vault.connect(env.bob).deposit(amount, env.bob.address);
            const util = await env.vault.getUtilization();
            expect(util).to.equal(0);
        });
    });

    describe("TradingCore Coverage", function () {
        it("should handle market info queries", async function () {
            const m = await env.trading.getMarketInfo(MARKET);
            expect(m.isActive).to.be.true;
            expect(await env.trading.activeMarketCount()).to.be.gt(0);
            expect(await env.trading.activeMarketAt(0)).to.equal(MARKET);
        });

        it("should handle funding state queries", async function () {
            expect((await env.trading.getFundingState(MARKET)).lastSettlement).to.equal(0);
        });

        it("should handle nextPositionId and user positions", async function () {
            expect(await env.trading.nextPositionId()).to.equal(1);
            expect((await env.trading.getUserPositions(env.alice.address)).length).to.equal(0);
        });

        it("should handle position lifecycle with collateral ops", async function () {
            await setupPositionWithLP();
            const pos = await env.trading.getPosition(1);
            expect(pos.state).to.equal(1);

            await env.trading.connect(env.alice).setTrailingStop(1, 500);

            // Add collateral
            const addAmount = ethers.parseUnits("100", 6);
            await env.usdc.connect(env.admin).mintTo(env.alice.address, addAmount);
            await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
            await env.trading.connect(env.alice).addCollateral(1, addAmount, 50, false);

            // Withdraw collateral
            await env.trading.connect(env.alice).withdrawCollateral(1, ethers.parseUnits("10", 6));

            const [colAmt] = await env.trading.getPositionCollateral(1);
            expect(colAmt).to.be.gt(0);

            // Settle funding
            await ethers.provider.send("evm_increaseTime", [3600 * 8]);
            await ethers.provider.send("evm_mine", []);
            await feedPrice(3000); // Prevent StalePrice check failure after time travel
            await env.trading.settleFunding(MARKET);
            await env.trading.settlePositionFunding(1);
        });

        it("should handle cancel order", async function () {
            await feedPrice(3000);
            const bob = ethers.parseUnits("1000000", 6);
            await env.usdc.connect(env.admin).mintTo(env.bob.address, bob);
            await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
            await env.vault.connect(env.bob).deposit(bob, env.bob.address);

            const alice = ethers.parseUnits("10000", 6);
            await env.usdc.connect(env.admin).mintTo(env.alice.address, alice);
            await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

            await env.trading.connect(env.alice).createOrder(
                0, MARKET, ethers.parseUnits("3000", 6), ethers.parseUnits("300", 18),
                ethers.parseUnits("3000", 18), true, 10000, 0,
                { value: ethers.parseEther("0.01") }
            );

            // Cancel the order
            await env.trading.connect(env.alice).cancelOrder(1);
        });
    });

    describe("MarketCalendar Coverage", function () {
        it("should handle 24x7 market", async function () {
            await env.marketCalendar.connect(env.admin).setMarketConfig("BTC-USD", 0, 1439, 0, true);
            expect(await env.marketCalendar.isMarketOpen("BTC-USD")).to.be.true;
        });

        it("should reject invalid market config", async function () {
            await expect(
                env.marketCalendar.connect(env.admin).setMarketConfig("BAD", 960, 570, 0, false)
            ).to.be.revertedWithCustomError(env.marketCalendar, "OpenMustBeBeforeClose");
        });
    });

    describe("DividendManager Coverage", function () {
        it("should handle dividend index queries", async function () {
            expect(await env.dividendManager.getDividendIndex(MARKET_ID)).to.equal(0);
        });

        it("should handle multiple distributions", async function () {
            await env.dividendManager.connect(env.admin).distributeDividend(MARKET_ID, ethers.parseUnits("5", 6));
            await env.dividendManager.connect(env.admin).distributeDividend(MARKET_ID, ethers.parseUnits("10", 6));
            expect(await env.dividendManager.getDividendIndex(MARKET_ID)).to.equal(15000000n);
        });
    });

    describe("AllowListCompliance Coverage", function () {
        it("should handle whitelist management", async function () {
            const [, , , , , , addr7] = await ethers.getSigners();
            expect(await env.complianceManager.isAllowed(addr7.address, MARKET, "0x")).to.be.false;
            await env.complianceManager.connect(env.admin).setWhitelist(addr7.address, true);
            expect(await env.complianceManager.isAllowed(addr7.address, MARKET, "0x")).to.be.true;
            await env.complianceManager.connect(env.admin).setWhitelist(addr7.address, false);
            expect(await env.complianceManager.isAllowed(addr7.address, MARKET, "0x")).to.be.false;
        });
    });

    describe("PositionToken Coverage", function () {
        it("should handle position token queries", async function () {
            await setupPositionWithLP();
            expect(await env.positionToken.ownerOf(1)).to.equal(env.alice.address);
            expect(await env.positionToken.balanceOf(env.alice.address)).to.equal(1);
        });
    });

    describe("Pause Coverage", function () {
        it("should handle trading pause", async function () {
            await env.trading.connect(env.admin).pause();
            await expect(env.trading.settleFunding(MARKET)).to.be.reverted;
            await env.trading.connect(env.admin).unpause();
        });
    });
});
