import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "./helpers";

describe("OracleAggregator - Core Data Feeds", function () {
    let env: any;

    beforeEach(async () => {
        env = await deployTestEnvironment();
    });

    it("should allow operator to add a supported market", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        const feedId = ethers.ZeroHash;

        await env.oracle.connect(env.admin).addSupportedMarket(dummyMarket);
        await env.oracle.connect(env.admin).setPythFeed(dummyMarket, feedId, 3600, 0);

        const markets = await env.oracle.getSupportedMarkets();
        const found = markets.map((m: string) => m.toLowerCase()).includes(dummyMarket.toLowerCase());
        expect(found).to.be.true;
    });

    it("should revert getPrice for a market with no valid Pyth data", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await env.oracle.connect(env.admin).addSupportedMarket(dummyMarket);
        await env.oracle.connect(env.admin).setPythFeed(dummyMarket, ethers.ZeroHash, 3600, 0);

        await expect(env.oracle.getPrice(dummyMarket)).to.be.reverted;
    });

    it("should allow setting the market ID for a supported market", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await env.oracle.connect(env.admin).addSupportedMarket(dummyMarket);
        await env.oracle.connect(env.admin).setMarketId(dummyMarket, "BTC-USD");
        
        const marketId = await env.oracle.marketIds(dummyMarket);
        expect(marketId).to.equal("BTC-USD");
    });

    it("should expose default max deviation bps configuration", async function () {
        const defaultBps = await env.oracle.defaultMaxDeviationBps();
        expect(defaultBps).to.be.gte(0);
    });
});
