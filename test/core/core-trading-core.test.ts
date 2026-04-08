import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("TradingCore - Position Math & Flow", function () {
    let env: any;
    let marketAddress: string;

    beforeEach(async () => {
        env = await deployTestEnvironment();
        marketAddress = env.alice.address;
        const feedId = ethers.hexlify(ethers.zeroPadValue(ethers.getBytes("0x01"), 32));
        
        await env.oracle.connect(env.admin).setPythFeed(marketAddress, feedId, 3600, 0);
        await env.oracle.connect(env.admin).addSupportedMarket(marketAddress);
        
        await env.trading.connect(env.admin).setMarket(
            marketAddress, marketAddress,
            100n, ethers.parseUnits("1000000", 18), ethers.parseUnits("5000000", 18), 500, 1000, 3600
        );

        await env.usdc.connect(env.admin).mintTo(env.alice.address, ethers.parseUnits("100000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        await env.usdc.connect(env.admin).mintTo(env.bob.address, ethers.parseUnits("1000000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("100000", 6), env.bob.address);
    });

    it("should revert order creation with zero collateral", async function () {
        await expect(
            env.trading.connect(env.alice).createOrder(
                1, marketAddress, ethers.parseUnits("5000", 18), 0, 0, true, 0, 0,
                { value: ethers.parseEther("0.001") }
            )
        ).to.be.reverted;
    });

    it("should revert createOrder for an unlisted market", async function () {
        const unlistedMarket = ethers.Wallet.createRandom().address;
        await expect(
            env.trading.connect(env.alice).createOrder(
                1, unlistedMarket, ethers.parseUnits("5000", 18), ethers.parseUnits("1000", 6), 0, true, 0, 0,
                { value: ethers.parseEther("0.001") }
            )
        ).to.be.reverted;
    });
});
