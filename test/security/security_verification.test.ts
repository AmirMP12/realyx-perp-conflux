import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Security Verification", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        const TradingCoreViews = await ethers.getContractFactory("TradingCoreViews");
        const views = await TradingCoreViews.deploy();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());
        await env.trading.connect(env.admin).setTradingViews(await views.getAddress());
        
        const setupMarket = async (market: string, feedId: string) => {
            await env.trading.connect(env.admin).setMarket(market, market, 100, 1000000e6, 10000000e6, 500, 1000, 86400); // 5% mm, 10% im
            await env.oracle.connect(env.admin).addSupportedMarket(market);
            await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
            await env.trading.connect(env.admin).setMarketId(market, mktId);
        };

        const mktId = "MKT-FIX";
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("FIX"));
        const market = ethers.Wallet.createRandom().address;
        await setupMarket(market, feedId);

        await env.usdc.mintTo(env.admin.address, 2000000e6);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1000000e6, env.admin.address);
        await env.vault.connect(env.admin).stakeInsurance(1000000e6, env.admin.address);
        
        return { env, views, market, feedId };
    }

    async function pushPrice(env: any, feedId: string, price: bigint) {
        const now = await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId, price, 100n, -8, price, 100n, now, now
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    it("verifies liquidation price math is correct (1/lev - mm%)", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        await pushPrice(env, feedId, 100n * 10n**8n);

        // 10x leverage: inverseL = 10%, dynamic MM at 10x = 5.5%
        // liqPrice = entry * (1 + mm - 1/L) = 100 * (1 + 0.055 - 0.1) = 95.5
        await env.usdc.mintTo(env.alice.address, 1000e6);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        await env.trading.connect(env.alice).createOrder(0, market, 1000e6, 1005e5, 0, true, 0, 0, { value: ethers.parseEther("0.1") });
        await env.trading.connect(env.keeper).executeOrder(1, []);

        const pos = await env.trading.getPosition(1);
        const liqPrice = BigInt(pos.liquidationPrice);

        expect(liqPrice).to.be.closeTo(955n * 10n ** 17n, 10n ** 16n);
    });

    it("verifies no double fee deduction in payout", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        await pushPrice(env, feedId, 100n * 10n**8n);
        
        await env.usdc.mintTo(env.alice.address, 1000e6);
        const aliceInitialBalance = await env.usdc.balanceOf(env.alice.address);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        // Open position: 1000 USDC size, 100 USDC collateral
        // Fee is e.g. 0.1% = 1 USDC.
        await env.trading.connect(env.alice).createOrder(0, market, 1000e6, 101e6, 0, true, 0, 0, { value: ethers.parseEther("0.1") });
        await env.trading.connect(env.keeper).executeOrder(1, []);
        
        // Price stays same.
        // Close position.
        // Payout should be: Collateral (101) - Opening Fee (1) - Closing Fee (1) = 99 USDC.
        await time.increase(1000);
        await env.trading.connect(env.alice).closePosition({
            positionId: 1, closeSize: 0, minReceive: 0, deadline: (await time.latest()) + 1000
        });
        
        const aliceFinalBalance = await env.usdc.balanceOf(env.alice.address);
        const received = aliceFinalBalance - (aliceInitialBalance - 101000000n);
        
        // Net collateral after open/close fees: collateral(101) - openFee(~0.5) - closeFee(~0.5) = ~100 USDC back.
        expect(received).to.be.closeTo(100000000n, 500000n);
    });

    it("verifies vault consistency (no fee double counting)", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        await pushPrice(env, feedId, 100n * 10n**8n);
        
        const vaultAssetsBefore = await env.vault.totalAssets();
        
        await env.usdc.mintTo(env.alice.address, 1000e6);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        // Open & Close
        await env.trading.connect(env.alice).createOrder(0, market, 1000e6, 110e6, 0, true, 0, 0, { value: ethers.parseEther("0.1") });
        await env.trading.connect(env.keeper).executeOrder(1, []);
        await time.increase(1000);
        await env.trading.connect(env.alice).closePosition({
            positionId: 1, closeSize: 0, minReceive: 0, deadline: (await time.latest()) + 1000
        });
        
        const vaultAssetsAfter = await env.vault.totalAssets();
        
        // LP share of open+close trading fees lands in vault accounting (internal 18-dec).
        const increase = vaultAssetsAfter - vaultAssetsBefore;
        expect(increase).to.be.closeTo(700000000000000000n, 200000000000000000n);
    });
});
