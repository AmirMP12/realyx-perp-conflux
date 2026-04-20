import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Oracle Emergency Price Branch Wave", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.liquidator.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.keeper.address);
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

    it("covers no-ref-price multi-confirmation and absolute-cap branches", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const validUntil = (await time.latest()) + 3600;

        const tx = await env.oracle.connect(env.alice).proposeEmergencyPrice(market, ethers.parseEther("50000"), validUntil);
        const receipt = await tx.wait();
        const events = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), receipt!.blockNumber);
        const proposalId = (events[events.length - 1] as any).args.proposalId;

        await expect(env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId)).to.be.reverted;
        await expect(env.oracle.connect(env.liquidator).confirmEmergencyPrice(proposalId)).to.be.reverted;
        await expect(env.oracle.connect(env.keeper).confirmEmergencyPrice(proposalId)).to.be.reverted;
    });

    it("covers has-ref-price deviation rejection branch", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("REF-PRICE-MARKET"));
        const validUntil = (await time.latest()) + 3600;

        await env.oracle.setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);

        const tx = await env.oracle.connect(env.alice).proposeEmergencyPrice(market, ethers.parseEther("1000"), validUntil);
        const receipt = await tx.wait();
        const events = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), receipt!.blockNumber);
        const proposalId = (events[events.length - 1] as any).args.proposalId;
        await expect(env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId)).to.be.reverted;
    });
});
