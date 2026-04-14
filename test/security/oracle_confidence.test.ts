import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Oracle Confidence", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        const market = env.alice.address;
        const feedId = ethers.encodeBytes32String("market-feed");
        
        // Setup market in OracleAggregator
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0); // 0 = use default 2% BPS
        
        // Disable TradingViews to keep things simple
        await env.trading.connect(env.admin).setTradingViews(ethers.ZeroAddress);
        
        // Setup market in TradingCore
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            30,
            ethers.parseUnits("1000000", 6),
            ethers.parseUnits("10000000", 6),
            100,
            200,
            3600
        );

        // Set a base price in MockPyth so Vault can calculate assets during deposit
        const basePrice = 10000000000n; // 100 * 10^8
        const baseUpdateData = await env.pyth.createPriceFeedUpdateData(
            feedId,
            basePrice,
            10000000n, // 0.1% confidence
            -8,
            basePrice,
            10000000n,
            await time.latest(),
            await time.latest()
        );
        await env.pyth.updatePriceFeeds([baseUpdateData]);

        // Tight oracle confidence cap so "high uncertainty" updates fail getPrice with InsufficientConfidence.
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 10n ** 18n);

        // Fund the vault
        const depositAmount = ethers.parseUnits("1000000", 6);
        await env.usdc.mintTo(env.admin.address, depositAmount);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(depositAmount, env.admin.address);

        await env.vault.totalAssets();

        return { env, market, feedId };
    }

    it("should revert executeOrder when oracle confidence is too low (high uncertainty)", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        const [user] = await ethers.getSigners();
        
        // Set TradingCore maxOracleUncertainty to 100 (1%)
        await env.trading.connect(env.admin).setParams(0, 100, 0, 0, 0, 0, 0);

        // Set price in MockPyth: 100 USDC (8 decimals in Pyth usually, but RWA might use 18)
        // OracleAggregator normalizes it. Let's use 100e8 for price and 1.5e8 for confidence.
        const price = 10000000000n; // 100 * 10^8
        const confidence = 150000000n; // 1.5 * 10^8 (1.5%)
        const expo = -8;
        const publishTime = await time.latest();

        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId,
            price,
            confidence,
            expo,
            price,
            confidence,
            publishTime,
            publishTime
        );

        await env.pyth.updatePriceFeeds([updateData]);

        // Create a market order
        await env.usdc.mintTo(user.address, ethers.parseUnits("1000", 6));
        await env.usdc.connect(user).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        await env.trading.connect(user).createOrder(
            0, // MARKET_INCREASE
            market,
            ethers.parseUnits("1000", 6),
            ethers.parseUnits("100", 6),
            0,
            true,
            500,
            0,
            { value: ethers.parseEther("0.1") }
        );
        const orderId = 1;

        // Execute order should revert due to high uncertainty (1.5% > 1% threshold)
        // Note: OracleAggregator allows up to 2%, so it won't revert there.
        await expect(env.trading.connect(env.keeper).executeOrder(orderId, [])).to.be.revertedWithCustomError(
            env.oracle,
            "InsufficientConfidence"
        );

        // Now lower the uncertainty: 0.5%
        const lowConfidence = 50000000n;
        const updateData2 = await env.pyth.createPriceFeedUpdateData(
            feedId,
            price,
            lowConfidence,
            expo,
            price,
            lowConfidence,
            publishTime + 1,
            publishTime
        );
        await env.pyth.updatePriceFeeds([updateData2]);
        
        // Execute order should now succeed
        await env.trading.connect(env.keeper).executeOrder(orderId, []);
    });

    it("should revert withdrawCollateral when oracle confidence is too low", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        const [user] = await ethers.getSigners();
        
        // 1. Setup a position first
        await env.trading.connect(env.admin).setParams(0, 100, 0, 0, 0, 0, 0); // 1% threshold
        const price = 10000000000n;
        const publishTime = await time.latest();
        
        const updateDataSuccess = await env.pyth.createPriceFeedUpdateData(
            feedId, price, 10000000n, -8, price, 10000000n, publishTime, publishTime
        );
        await env.pyth.updatePriceFeeds([updateDataSuccess]);

        await env.usdc.mintTo(user.address, ethers.parseUnits("1000", 6));
        await env.usdc.connect(user).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        await env.trading.connect(user).createOrder(
            0, market, ethers.parseUnits("1000", 6), ethers.parseUnits("100", 6),
            0, true, 500, 0, { value: ethers.parseUnits("0.1", 18) }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);
        const positionId = 1;

        // 2. Try to withdraw collateral with high uncertainty (1.5%)
        const highUncertaintyUpdate = await env.pyth.createPriceFeedUpdateData(
            feedId, price, 150000000n, -8, price, 150000000n, publishTime + 10, publishTime + 10
        );
        await env.pyth.updatePriceFeeds([highUncertaintyUpdate]);

        await expect(env.trading.connect(user).withdrawCollateral(positionId, ethers.parseUnits("10", 6))).to.be
            .revertedWithCustomError(env.oracle, "InsufficientConfidence");

        // 3. Lower uncertainty should allow withdrawal
        const lowUncertaintyUpdate = await env.pyth.createPriceFeedUpdateData(
            feedId, price, 10000000n, -8, price, 10000000n, publishTime + 20, publishTime + 20
        );
        await env.pyth.updatePriceFeeds([lowUncertaintyUpdate]);

        await env.trading.connect(user).withdrawCollateral(positionId, ethers.parseUnits("10", 6));
    });

    it("should revert closePosition when oracle confidence is too low", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        const [user] = await ethers.getSigners();
        
        await env.trading.connect(env.admin).setParams(0, 100, 0, 0, 0, 0, 0); // 1%
        const price = 10000000000n;
        const publishTime = await time.latest();
        
        await env.pyth.updatePriceFeeds([
            await env.pyth.createPriceFeedUpdateData(feedId, price, 10000000n, -8, price, 10000000n, publishTime, publishTime)
        ]);

        await env.usdc.mintTo(user.address, ethers.parseUnits("1000", 6));
        await env.usdc.connect(user).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.trading.connect(user).createOrder(0, market, ethers.parseUnits("1000", 6), ethers.parseUnits("100", 6), 0, true, 500, 0, { value: ethers.parseUnits("0.1", 18) });
        await env.trading.connect(env.keeper).executeOrder(1, []);
        await time.increase(300);

        // High uncertainty (1.5%)
        await env.pyth.updatePriceFeeds([
            await env.pyth.createPriceFeedUpdateData(feedId, price, 150000000n, -8, price, 150000000n, publishTime + 10, publishTime + 10)
        ]);

        const dl = BigInt(await time.latest()) + 10_000n;
        await expect(
            env.trading.connect(user).closePosition({
                positionId: 1,
                closeSize: ethers.parseUnits("1000", 6),
                minReceive: 0,
                deadline: dl,
            })
        ).to.be.revertedWithCustomError(env.oracle, "InsufficientConfidence");
    });

    it("should revert liquidatePosition when oracle confidence is too low", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        const [user] = await ethers.getSigners();
        
        await env.trading.connect(env.admin).setParams(0, 100, 0, 0, 0, 0, 0); // 1%
        const price = 10000000000n;
        const publishTime = await time.latest();
        
        await env.pyth.updatePriceFeeds([
            await env.pyth.createPriceFeedUpdateData(feedId, price, 10000000n, -8, price, 10000000n, publishTime, publishTime)
        ]);

        // Create high leverage position near liquidation
        await env.usdc.mintTo(user.address, ethers.parseUnits("1000", 6));
        await env.usdc.connect(user).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.trading.connect(user).createOrder(0, market, ethers.parseUnits("2000", 6), ethers.parseUnits("100", 6), 0, true, 500, 0, { value: ethers.parseUnits("0.1", 18) });
        await env.trading.connect(env.keeper).executeOrder(1, []);

        // Drop price to make it liquidatable
        // Maintenance Margin is 5% usually. Liquidatable if health < 1.
        // Price 100 -> 97 = -3% loss. With 20x leverage it would be -60%.
        // But here we had 2x leverage. Size 2000, Collateral 100.
        // Price 100 -> 97. PnL = (97-100) * 20 = -60.
        // Health = (100 - 60) / (2000 * 0.05) = 40 / 100 = 0.4 < 1. (Liquidatable)
        // receiveAmount = repayAmount (borrowed) + loss = borrowed + 60.
        // Debt is covered by 100 collateral.
        const lowPrice = 9700000000n; // -3%
        await env.pyth.updatePriceFeeds([
            await env.pyth.createPriceFeedUpdateData(feedId, lowPrice, 10000000n, -8, lowPrice, 10000000n, publishTime + 5, publishTime + 5)
        ]);

        // High uncertainty (1.5% of 97e8 approx 1.455e8)
        const highUncertainty = 150000000n; 
        await env.pyth.updatePriceFeeds([
            await env.pyth.createPriceFeedUpdateData(feedId, lowPrice, highUncertainty, -8, lowPrice, highUncertainty, publishTime + 10, publishTime + 10)
        ]);

        await expect(env.trading.connect(env.liquidator).liquidatePosition(1)).to.be.revertedWithCustomError(
            env.oracle,
            "InsufficientConfidence"
        );
            
        // Lower uncertainty allows liquidation
        await env.pyth.updatePriceFeeds([
            await env.pyth.createPriceFeedUpdateData(feedId, lowPrice, 10000000n, -8, lowPrice, 10000000n, publishTime + 15, publishTime + 15)
        ]);
        await env.trading.connect(env.liquidator).liquidatePosition(1);
    });
});
