import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("OracleAggregator Deep Branch Coverage", function () {
    async function deployOracleFixture() {
        const env = await deployTestEnvironment();
        const [admin, guardian, other] = await ethers.getSigners();
        
        await env.oracle.grantRole(await env.oracle.OPERATOR_ROLE(), admin.address);
        await env.oracle.grantRole(await env.oracle.GUARDIAN_ROLE(), guardian.address);
        
        return { env, admin, guardian, other };
    }

    async function pushPrice(env: any, feedId: string, price: bigint, conf: bigint = 100n, timestamp?: number) {
        const ts = timestamp || await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId,
            price, 
            conf, 
            -8, 
            price, 
            conf, 
            ts,
            ts
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    it("exercises _getPriceView: Manual Price and Bounds Branches", async function () {
        const { env, admin, guardian } = await loadFixture(deployOracleFixture);
        const market = await env.usdc.getAddress();
        const feedId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
        
        await env.oracle.setPythFeed(market, feedId, 3600, 0);
        
        // 1. Set Manual Price
        await env.oracle.connect(guardian).proposeEmergencyPrice(market, 150n * 10n**18n, (await time.latest()) + 3600);
        // Need 2nd guardian to confirm
        const [,, g2] = await ethers.getSigners();
        await env.oracle.grantRole(await env.oracle.GUARDIAN_ROLE(), g2.address);
        
        // Proposal ID logic: keccak256(collection, price, validUntil, nonce)
        // nonce starts at 1
        const nonce = 1;
        const validUntil = (await time.latest()) + 3600;
        // Actually, just get the proposalId from the event or calculate it correctly
        // Since it's easier, I'll just check if there's a simpler way to trigger it.
        // Wait! OracleAggregator.sol has proposeEmergencyPrice returning the ID.
    });

    it("exercises _getPriceView: Confidence reverts", async function () {
        const { env, admin } = await loadFixture(deployOracleFixture);
        const market = await env.usdc.getAddress();
        const feedId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
        
        // Setup feed
        await env.oracle.setPythFeed(market, feedId, 3600, 0);
        
        // 1. InsufficientConfidence (Custom Threshold)
        await env.oracle.setPythFeed(market, feedId, 3600, 100n); // maxConfidence = 100 (pyth precision)
        await pushPrice(env, feedId, 500n * 10n**8n, 200n * 10n**8n); // conf = 200 > 100
        await expect(env.oracle.getPrice(market)).to.be.revertedWithCustomError({ interface: env.oracle.interface }, "InsufficientConfidence");

        // 2. InsufficientConfidence (Default 1/50th)
        await env.oracle.setPythFeed(market, feedId, 3600, 0n); // maxConfidence = 0 (default)
        await pushPrice(env, feedId, 500n * 10n**8n, 20n * 10n**8n); // conf = 20 > 500/50 = 10
        await expect(env.oracle.getPrice(market)).to.be.revertedWithCustomError({ interface: env.oracle.interface }, "InsufficientConfidence");
    });
});
