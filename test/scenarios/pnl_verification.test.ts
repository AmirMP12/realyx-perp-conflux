import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("PnL Verification", function () {
    async function fixture() {
        const env = await deployTestEnvironment();

        const mktId = "MKT-PNL";
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("PNL"));
        const market = ethers.Wallet.createRandom().address;
        
        await env.trading.connect(env.admin).setMarket(market, market, 100, 1000000e6, 10000000e6, 500, 1000, 86400); 
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.trading.connect(env.admin).setMarketId(market, mktId);

        await env.usdc.mintTo(env.admin.address, 2000000e6);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(1000000e6, env.admin.address);
        
        return { env, market, feedId };
    }

    async function pushPrice(env: any, feedId: string, price: bigint) {
        const now = await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId, price, 100n, -8, price, 100n, now, now
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    it("should correctly settle profit (Alice makes 100 USDC profit)", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        
        // Initial Price: 100
        await pushPrice(env, feedId, 100n * 10n**8n);
        
        await env.usdc.mintTo(env.alice.address, 1000e6);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        // Open position: 1000 USDC size, 100 USDC collateral (10x leverage)
        // Ignoring fees for simplicity in calculation (though they will be deducted)
        await env.trading.connect(env.alice).createOrder(0, market, 1000e6, 101e6, 0, true, 0, 0, { value: ethers.parseEther("0.1") });
        await env.trading.connect(env.keeper).executeOrder(1, []);
        
        // Alice balance should be 1000 - 101 = 899 USDC
        expect(await env.usdc.balanceOf(env.alice.address)).to.equal(899000000n);

        // Price goes to 110 (10% pump)
        // Profit = 10% of 1000 = 100 USDC.
        await pushPrice(env, feedId, 110n * 10n**8n);
        
        await time.increase(1000);
        await env.trading.connect(env.alice).closePosition({
            positionId: 1, closeSize: 0, minReceive: 0, deadline: (await time.latest()) + 1000
        });
        
        // Final Balance should be approx 899 + 101 (collateral) + 100 (profit) - 1 (fees) = 1100-ish
        const finalBalance = await env.usdc.balanceOf(env.alice.address);
        // Profit is 100. Fees are approx 1. Net gain approx 99.
        expect(finalBalance).to.be.closeTo(1099000000n, 5000000n); // allow some range for fees
        expect(finalBalance).to.be.gt(1090000000n); 
    });

    it("should correctly settle loss (Alice loses 50 USDC)", async function () {
        const { env, market, feedId } = await loadFixture(fixture);
        
        await pushPrice(env, feedId, 100n * 10n**8n);
        
        await env.usdc.mintTo(env.alice.address, 1000e6);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        await env.trading.connect(env.alice).createOrder(0, market, 1000e6, 101e6, 0, true, 0, 0, { value: ethers.parseEther("0.1") });
        await env.trading.connect(env.keeper).executeOrder(1, []);

        // Price goes to 95 (5% dump)
        // Loss = 5% of 1000 = 50 USDC.
        await pushPrice(env, feedId, 95n * 10n**8n);
        
        await time.increase(1000);
        await env.trading.connect(env.alice).closePosition({
            positionId: 1, closeSize: 0, minReceive: 0, deadline: (await time.latest()) + 1000
        });
        
        // Final Balance should be approx 899 + 101 (collateral) - 50 (loss) - 1 (fees) = 949-ish
        const finalBalance = await env.usdc.balanceOf(env.alice.address);
        expect(finalBalance).to.be.closeTo(949000000n, 5000000n);
        expect(finalBalance).to.be.lt(960000000n);
    });
});
