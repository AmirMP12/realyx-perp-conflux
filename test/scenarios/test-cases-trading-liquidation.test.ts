import { ethers } from "hardhat";
import { expect } from "chai";
import { deployTestEnvironment } from "../helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Branch Coverage 3 - Trading and Liquidation", function () {
    let env: any;
    const PRICE_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

    async function pushPrice(id: string, price: bigint) {
        const updateData = await env.pyth.createPriceFeedUpdateData(
            id,
            price, // price
            100n, // confidence
            -8, // exponent
            price, // emaPrice
            100n, // emaConf
            await time.latest(),
            await time.latest()
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    async function setupMarketAndDeposit(aliceAmount: bigint = 100000n * 10n**6n) {
        await env.usdc.mintTo(env.alice.address, aliceAmount);
        await env.usdc.connect(env.alice).approve(await env.vault.getAddress(), aliceAmount);
        await env.usdc.mintTo(env.bob.address, aliceAmount);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), aliceAmount);

        // Deposit liquidity
        await env.vault.connect(env.alice).deposit(10000n * 10n**6n, env.alice.address);
        // Stake into insurance fund to cover bad debts during liquidation tests
        await env.vault.connect(env.alice).stakeInsurance(5000n * 10n**6n, env.alice.address);

        const market = ethers.Wallet.createRandom().address;
        
        // Oracle setup
        await env.oracle.connect(env.admin).setPythFeed(market, PRICE_ID, 3600, 0);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await pushPrice(PRICE_ID, 50000n * 10n**8n); // $50,000

        await env.trading.connect(env.admin).setMarket(
            market, market, 100, ethers.parseUnits("1000000", 6), ethers.parseUnits("10000000", 6), 500, 1000, 86400
        );
        await env.trading.connect(env.admin).setMarketId(market, "TEST_MKT");
        
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        return { market, PRICE_ID };
    }

    beforeEach(async function () {
        env = await deployTestEnvironment();
    });

    describe("TradingCore: Collateral Management", function () {
        it("addCollateral and withdrawCollateral successfully", async function () {
            const { market } = await setupMarketAndDeposit();
            
            // Create MARKET_INCREASE order
            // Note: sizeDelta is in USDC precision (scaled to 1e18 internally)
            await env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("100", 6), ethers.parseUnits("20", 6), 0, true, 500, 0, { value: ethers.parseEther("0.01") }
            );

            // Execute order using Keeper
            await env.trading.connect(env.keeper).executeOrder(1, []);

            // Now position is OPEN, we can addCollateral
            await env.trading.connect(env.alice).addCollateral(1, ethers.parseUnits("10", 6), 50, false);

            // Withdraw collateral
            await env.trading.connect(env.alice).withdrawCollateral(1, ethers.parseUnits("5", 6));
        });

        it("addCollateral max leverage reverting", async function () {
            const { market } = await setupMarketAndDeposit();
            await env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("2000", 6), ethers.parseUnits("100", 6), 0, true, 500, 0, { value: ethers.parseEther("0.01") }
            );
            await env.trading.connect(env.keeper).executeOrder(1, []);
            
            // Try to add collateral with a very low max leverage restriction
            await expect(
                env.trading.connect(env.alice).addCollateral(1, ethers.parseUnits("1", 6), 1, false)
            ).to.be.reverted; 
        });

        it("withdrawCollateral reverting on insufficient collateral", async function () {
            const { market } = await setupMarketAndDeposit();
            await env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("1000", 6), ethers.parseUnits("200", 6), 0, true, 500, 0, { value: ethers.parseEther("0.01") }
            );
            await env.trading.connect(env.keeper).executeOrder(1, []);

            // Withdraw more than possible while staying above maintenance margin
            // IM = 10%. Initial margin = $100.
            // Collateral after fee (~0.5) = $199.5.
            // Alice wants to withdraw $150. Remaining = $49.5. Fails IM check ($100).
            const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);
            await expect(
                env.trading.connect(env.alice).withdrawCollateral(1, ethers.parseUnits("150", 6))
            ).to.be.revertedWithCustomError(tradingLib, "InsufficientCollateral"); 
        });
    });

    describe("TradingCore: Liquidation paths", function () {
        it("liquidatePosition branches", async function () {
            const { market, PRICE_ID } = await setupMarketAndDeposit();
            
            // High leverage position: $1000 size, $20 collateral (50x)
            await env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("1000", 6), ethers.parseUnits("20", 6), 0, true, 500, 0, { value: ethers.parseEther("0.01") }
            );
            await env.trading.connect(env.keeper).executeOrder(1, []);

            // Price drop 2% ($50,000 -> $49,000)
            // PnL = (1000 * -1000) / 50000 = -$20. 
            // Collateral ($20 - opening fee) - $20 = negative.
            await pushPrice(PRICE_ID, 49000n * 10n**8n);

            // Execute liquidation
            await env.trading.connect(env.liquidator).liquidatePosition(1);
            
            const pos = await env.trading.getPosition(1);
            expect(pos.state).to.equal(3); // LIQUIDATED
        });

        it("liquidatePosition: not liquidatable revert", async function () {
            const { market } = await setupMarketAndDeposit();
            await env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("100", 6), ethers.parseUnits("50", 6), 0, true, 500, 0, { value: ethers.parseEther("0.01") }
            );
            await env.trading.connect(env.keeper).executeOrder(1, []);

            const tradingLib = await ethers.getContractAt("TradingLib", env.libs.tradingLib);
            await expect(
                env.trading.connect(env.liquidator).liquidatePosition(1)
            ).to.be.revertedWithCustomError(tradingLib, "PositionNotLiquidatable");
        });
    });

    describe("TradingCore: Complex Orders (Decrease, Limit)", function () {
        it("MARKET_DECREASE order successfully", async function () {
            const { market } = await setupMarketAndDeposit();
            await env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("100", 6), ethers.parseUnits("20", 6), 0, true, 500, 0, { value: ethers.parseEther("0.01") }
            );
            await env.trading.connect(env.keeper).executeOrder(1, []);

            // Create decrease (partial close 50%)
            await env.trading.connect(env.alice).createOrder(
                1, market, ethers.parseUnits("50", 6), 0, 0, true, 500, 1, { value: ethers.parseEther("0.01") }
            );
            await env.trading.connect(env.keeper).executeOrder(2, []);
            
            const pos = await env.trading.getPosition(1);
            expect(pos.size).to.equal(ethers.parseUnits("50", 6) * 10n ** 12n);
        });

        it("LIMIT_INCREASE executed", async function () {
            const { market, PRICE_ID } = await setupMarketAndDeposit();
            // triggerPrice = 45000
            await env.trading.connect(env.alice).createOrder(
                2, market, ethers.parseUnits("100", 6), ethers.parseUnits("20", 6), ethers.parseUnits("45000", 18), true, 500, 0, { value: ethers.parseEther("0.01") }
            );
            
            // Fails execution if price is too high (50k > 45k)
            await expect(
                env.trading.connect(env.keeper).executeOrder(1, [])
            ).to.be.reverted;

            // Price meets trigger
            await pushPrice(PRICE_ID, 44000n * 10n**8n);
            await env.trading.connect(env.keeper).executeOrder(1, []);
            
            const pos = await env.trading.getPosition(1);
            expect(pos.state).to.equal(1); // OPEN
        });
    });
});
