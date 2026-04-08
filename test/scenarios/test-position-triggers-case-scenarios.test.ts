import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("PositionTriggers Branch Wave", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        return { env };
    }

    async function pushPrice(env: any, feedId: string, price: bigint, conf: bigint = 1n) {
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

    async function openLongPosition(env: any) {
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes(`TRIG-${Date.now()}`));

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
        await env.trading.connect(env.admin).setMarketId(market, "BTC-USD");
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
            ethers.parseEther("100"),
            0,
            true,
            0,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);
        return { market };
    }

    it("covers stop loss / take profit invalid and ownership branches", async function () {
        const { env } = await loadFixture(fixture);
        await openLongPosition(env);

        await expect(env.trading.connect(env.bob).setStopLoss(1, ethers.parseEther("90"))).to.be.reverted;
        await expect(env.trading.connect(env.alice).setStopLoss(999, ethers.parseEther("90"))).to.be.reverted;
        await expect(env.trading.connect(env.alice).setStopLoss(1, ethers.parseEther("120"))).to.be.reverted;
        await expect(env.trading.connect(env.alice).setTakeProfit(1, ethers.parseEther("80"))).to.be.reverted;

        await env.trading.connect(env.alice).setStopLoss(1, ethers.parseEther("90"));
        await env.trading.connect(env.alice).setTakeProfit(1, ethers.parseEther("110"));
    });

    it("covers trailing stop invalid and valid branches", async function () {
        const { env } = await loadFixture(fixture);
        await openLongPosition(env);

        await expect(env.trading.connect(env.alice).setTrailingStop(999, 100)).to.be.reverted;
        await expect(env.trading.connect(env.alice).setTrailingStop(1, 100_000)).to.be.reverted;
        await env.trading.connect(env.alice).setTrailingStop(1, 100);
    });
});
