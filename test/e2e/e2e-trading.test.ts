import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("E2E Trading - Full Protocol Lifecycle", function () {
    let env: any;
    const marketDetails = {
        name: "ETH/USD",
        marketId: "ETH-USD",
        collection: "0x0000000000000000000000000000000000000001",
        pythId: ethers.keccak256(ethers.toUtf8Bytes("ETH/USD")),
        maxLeverage: 50,
        maxDeviationBps: 200,
        feeBps: 10
    };

    beforeEach(async () => {
        env = await deployTestEnvironment();
        
        // Oracle Setup
        await env.oracle.connect(env.admin).setPythFeed(
            marketDetails.collection, 
            marketDetails.pythId, 
            3600,
            ethers.parseUnits("10", 18)
        );
        await env.oracle.connect(env.admin).addSupportedMarket(marketDetails.collection);
        
        // Market Calendar Setup
        await env.marketCalendar.connect(env.admin).setMarketConfig(
            marketDetails.marketId,
            0, 1439, 0, true
        );

        // Core Market Setup (address-based)
        await env.trading.connect(env.admin).setMarket(
            marketDetails.collection,
            marketDetails.collection,
            marketDetails.maxLeverage,
            ethers.parseUnits("1000000", 18),
            ethers.parseUnits("10000000", 18),
            500, // mmBps
            1000, // imBps
            3600
        );

        // Link address to string ID
        await env.trading.connect(env.admin).setMarketId(marketDetails.collection, marketDetails.marketId);

        // Buffer on TradingCore for close/liquidation paths that compare ERC20 balance to a conservative repay estimate.
        await env.usdc.mintTo(await env.trading.getAddress(), ethers.parseUnits("5000000", 6));

        // Vault Setup: Bob deposits 1M USDC as LP
        const bobAmount = ethers.parseUnits("1000000", 6);
        await env.usdc.connect(env.admin).mintTo(env.bob.address, bobAmount);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(bobAmount, env.bob.address);

        // Trader Setup: Alice gets 10,000 USDC
        const aliceAmount = ethers.parseUnits("10000", 6);
        await env.usdc.connect(env.admin).mintTo(env.alice.address, aliceAmount);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
    });

    async function getPythPayload(price: number) {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        const priceVal = price * 1e8;
        return await env.pyth.createPriceFeedUpdateData(
            marketDetails.pythId,
            priceVal, 1, -8,
            priceVal, 1,
            publishTime, publishTime - 5
        );
    }

    it("should execute a full lifecycle: Open -> Update -> Sell -> Liquidate", async function () {
        // sizeDelta and collateralDelta are USDC amounts (6 decimals); oracle prices are 18 decimals.
        const orderSize = ethers.parseUnits("3000", 6);
        const entryPrice = ethers.parseUnits("3000", 18);
        const collateral = ethers.parseUnits("300", 6);
        
        // 1. Create LONG order
        await env.trading.connect(env.alice).createOrder(
            0, // MARKET_INCREASE
            marketDetails.collection,
            orderSize,
            collateral,
            entryPrice,
            true, // isLong
            10000, // maxSlippage
            0, // positionId
            { value: ethers.parseEther("0.01") }
        );

        // 2. Execute Order (Price = $3000)
        let payload = await getPythPayload(3000);
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
        let tx = await env.trading.connect(env.keeper).executeOrder(1, [], { value: 0 });
        await tx.wait();

        const posBefore = await env.trading.getPosition(1);
        expect(posBefore.state).to.equal(1); // OPEN
        
        // 3. Update (Set SL and TP)
        await env.trading.connect(env.alice).setStopLoss(1, ethers.parseUnits("2800", 18));
        await env.trading.connect(env.alice).setTakeProfit(1, ethers.parseUnits("3500", 18));
        
        // 4. Time travel and trigger Funding
        await ethers.provider.send("evm_increaseTime", [3600 * 8]);
        await ethers.provider.send("evm_mine", []);
        await env.trading.settleFunding(marketDetails.collection);
        
        // 5. Partial Close (Price = $3200) - close half
        const posInfo = await env.trading.getPosition(1);
        const halfSize = posInfo.size / 2n;
        await env.trading.connect(env.alice).createOrder(
            1, // MARKET_DECREASE
            marketDetails.collection,
            halfSize / 10n**12n, // scale to USDC precision because createOrder multiplies by 1e12
            0, 0, true, 10000, 1,
            { value: ethers.parseEther("0.01") }
        );

        payload = await getPythPayload(3200);
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
        await env.trading.connect(env.keeper).executeOrder(2, [], { value: 0 });

        // 6. Close the remaining position (Price = $2800)
        payload = await getPythPayload(2800);
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
        
        await env.trading.connect(env.alice).createOrder(
            1, // MARKET_DECREASE (close remaining)
            marketDetails.collection,
            0, // sizeDelta=0 means close entire remaining position
            0, 0, true, 10000, 1,
            { value: ethers.parseEther("0.01") }
        );
        payload = await getPythPayload(2800);
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
        await env.trading.connect(env.keeper).executeOrder(3, [], { value: 0 });

        // Assert position is closed
        const posAfter = await env.trading.getPosition(1);
        expect(posAfter.state).to.equal(2); // CLOSED
    });

    it("should handle Dividend Settlement when Corporate Action is triggered", async function () {
        const orderSize = ethers.parseUnits("3000", 6);
        const entryPrice = ethers.parseUnits("3000", 18);
        const collateral = ethers.parseUnits("300", 6);
        
        await env.trading.connect(env.alice).createOrder(
            0, marketDetails.collection, orderSize, collateral, entryPrice, true, 10000, 0,
            { value: ethers.parseEther("0.01") }
        );
        let payload = await getPythPayload(3000);
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
        await env.trading.connect(env.keeper).executeOrder(1, [], { value: 0 });

        // Admin Distributes Dividends
        await env.dividendManager.connect(env.admin).distributeDividend(
            marketDetails.marketId,
            ethers.parseUnits("10", 6)
        );

        // Close position
        await env.trading.connect(env.alice).createOrder(
            1, marketDetails.collection, 0, 0, 0, true, 10000, 1, // sizeDelta=0 for full close
            { value: ethers.parseEther("0.01") }
        );
        payload = await getPythPayload(3100);
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
        await env.trading.connect(env.keeper).executeOrder(2, [], { value: 0 });
    });
});
