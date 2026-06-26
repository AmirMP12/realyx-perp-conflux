import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { feedId, pushRedstonePrice, pushRedstonePrices } from "../helpers/redstone";

const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REDSTONE_KEEPER_ROLE"));

const BTC = "0x00000000000000000000000000000000000000b7";
const TSLA = "0x0000000000000000000000000000000000000753";
const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, keeper] = await ethers.getSigners();
    const Harness = await ethers.getContractFactory("RedStoneAdapterHarness");
    const adapter = await Harness.deploy(admin.address);
    await adapter.waitForDeployment();
    await adapter.grantRole(KEEPER_ROLE, keeper.address);
    return { adapter, admin, keeper };
}

/**
 * Verifies the `_normalize` decimal handling and the `_ingest` invalid-value
 * guards, plus the batch-push unconfigured-market revert. Covers feed decimals
 * other than 8, zero and round-to-zero values, and an unconfigured market in a
 * batch.
 */
describe("RedStoneAdapter — normalize and ingest", () => {
    it("_normalize returns the raw value unchanged when feedDecimals == 18", async () => {
        const { adapter, admin, keeper } = await loadFixture(deploy);
        await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 18, 3600);
        // payload carries 18-decimal value -> raw == 50000e18, no scaling applied.
        await pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 50_000, decimals: 18 }]);
        const [price, , , valid] = await adapter.getPrice(BTC);
        expect(price).to.equal(e18(50_000));
        expect(valid).to.equal(true);
    });

    it("_normalize scales down when feedDecimals > 18", async () => {
        const { adapter, admin, keeper } = await loadFixture(deploy);
        await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 20, 3600);
        // raw == 50000 * 1e20, normalized = raw / 1e2 == 50000e18.
        await pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 50_000, decimals: 20 }]);
        const [price, , , valid] = await adapter.getPrice(BTC);
        expect(price).to.equal(e18(50_000));
        expect(valid).to.equal(true);
    });

    it("reverts InvalidRedStoneValue when the signed payload value is zero (raw == 0)", async () => {
        const { adapter, admin, keeper } = await loadFixture(deploy);
        await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);
        await expect(
            pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 0 }]),
        ).to.be.revertedWithCustomError(adapter, "InvalidRedStoneValue");
    });

    it("reverts InvalidRedStoneValue when normalization rounds down to zero", async () => {
        const { adapter, admin, keeper } = await loadFixture(deploy);
        // 36-decimal feed but a raw value of 5 -> normalized = 5 / 1e18 == 0.
        await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 36, 3600);
        await expect(
            pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 5, decimals: 0 }]),
        ).to.be.revertedWithCustomError(adapter, "InvalidRedStoneValue");
    });

    it("pushPrices reverts FeedNotConfigured for an unconfigured market in the batch", async () => {
        const { adapter, admin, keeper } = await loadFixture(deploy);
        await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);
        // BTC configured, TSLA not -> the loop trips FeedNotConfigured on TSLA.
        await expect(
            pushRedstonePrices(
                adapter,
                keeper,
                [BTC, TSLA],
                [
                    { dataFeedId: "BTC", value: 50_000 },
                    { dataFeedId: "TSLA", value: 250 },
                ],
            ),
        ).to.be.revertedWithCustomError(adapter, "FeedNotConfigured");
    });
});
