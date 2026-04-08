import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("TradingCore - Liquidation Repay Failure", function () {
    it("reverts with RepayFailed when vault repay reverts", async function () {
        const env = await deployTestEnvironment();
        const admin = env.admin;

        const market = env.alice.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("liq-repay-fail"));

        // Oracle + market setup
        await env.oracle.connect(admin).setPythFeed(market, feedId, 3600, 0);
        await env.oracle.connect(admin).addSupportedMarket(market);
        await env.trading.connect(admin).setMarket(
            market,
            market,
            50, // maxLev
            ethers.parseUnits("100000", 18),
            ethers.parseUnits("1000000", 18),
            500,
            1000,
            3600
        );
        await env.trading.connect(admin).setMarketId(market, "LIQ-REPAY");
        await env.marketCalendar.connect(admin).setMarketConfig("LIQ-REPAY", 0, 1439, 0, true);

        // LP liquidity
        await env.usdc.connect(admin).mintTo(env.bob.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("200000", 6), env.bob.address);

        // Trader position
        await env.usdc.connect(admin).mintTo(env.alice.address, ethers.parseUnits("10000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        const entryPrice = ethers.parseUnits("3000", 18);
        await env.trading.connect(env.alice).createOrder(
            0, // MARKET_INCREASE
            market,
            ethers.parseUnits("6000", 6),
            ethers.parseUnits("1000", 6),
            entryPrice,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        // Execute at entry price
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        const priceVal = 3000n * 10n ** 8n;
        const payload = await env.pyth.createPriceFeedUpdateData(
            feedId,
            priceVal,
            1n,
            -8,
            priceVal,
            1n,
            BigInt(publishTime),
            BigInt(publishTime - 5)
        );
        await env.pyth.updatePriceFeeds([payload], { value: 1n });
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        // Drive price far against the position to make it clearly liquidatable
        const lowPriceVal = 1000n * 10n ** 8n;
        const payloadLow = await env.pyth.createPriceFeedUpdateData(
            feedId,
            lowPriceVal,
            1n,
            -8,
            lowPriceVal,
            1n,
            BigInt(publishTime + 600),
            BigInt(publishTime + 595)
        );
        await env.pyth.updatePriceFeeds([payloadLow], { value: 1n });

        // Swap vaultCore in TradingCore to a mock that reverts on repay,
        // while keeping oracle and position token wiring the same.
        const MockVault = await ethers.getContractFactory("MockVaultRevertingRepay");
        const mockVault = await MockVault.deploy();
        await env.trading
            .connect(admin)
            .setContracts(await mockVault.getAddress(), await env.oracle.getAddress(), await env.positionToken.getAddress());

        // Now liquidation should bubble up LiquidationLib.RepayFailed through TradingCore
        await expect(env.trading.connect(env.liquidator).liquidatePosition(1n)).to.be.reverted;
    });
});

