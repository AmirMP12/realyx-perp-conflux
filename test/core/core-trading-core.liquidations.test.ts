import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("TradingCore - Liquidations & Funding", function () {
    let env: any;
    let marketAddress: string;

    beforeEach(async () => {
        env = await deployTestEnvironment();
        marketAddress = env.alice.address;
        
        await env.oracle.connect(env.admin).setPythFeed(marketAddress, ethers.ZeroHash, 3600, 0);
        await env.oracle.connect(env.admin).addSupportedMarket(marketAddress);
        await env.trading.connect(env.admin).setMarket(
            marketAddress, marketAddress,
            100n, ethers.parseUnits("1000", 18), ethers.parseUnits("5000", 18), 500, 1000, 3600
        );

        await env.usdc.connect(env.admin).mintTo(env.alice.address, ethers.parseUnits("100000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        
        await env.usdc.connect(env.admin).mintTo(env.bob.address, ethers.parseUnits("1000000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("100000", 6), env.bob.address);
    });

    it("should revert liquidation on non-existent position", async function () {
        await expect(env.trading.connect(env.liquidator).liquidatePosition(999))
            .to.be.reverted;
    });
});
