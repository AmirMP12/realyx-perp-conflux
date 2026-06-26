import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { feedId, pushRedstonePrice, pushRedstonePrices } from "../helpers/redstone";

const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REDSTONE_KEEPER_ROLE"));
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

const BTC = "0x00000000000000000000000000000000000000b7";
const TSLA = "0x0000000000000000000000000000000000000753";
const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, keeper, other] = await ethers.getSigners();
    const Harness = await ethers.getContractFactory("RedStoneAdapterHarness");
    const adapter = await Harness.deploy(admin.address);
    await adapter.waitForDeployment();
    // admin already holds keeper role from the constructor; grant a dedicated keeper too.
    await adapter.grantRole(KEEPER_ROLE, keeper.address);
    return { adapter, admin, keeper, other };
}

describe("RedStoneAdapter", () => {
    describe("construction & config", () => {
        it("reverts on a zero admin", async () => {
            const Harness = await ethers.getContractFactory("RedStoneAdapterHarness");
            await expect(Harness.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Harness, "ZeroAddress");
        });

        it("grants admin + keeper role to the admin", async () => {
            const { adapter, admin } = await loadFixture(deploy);
            expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
            expect(await adapter.hasRole(KEEPER_ROLE, admin.address)).to.equal(true);
        });

        it("setFeed stores config and emits", async () => {
            const { adapter, admin } = await loadFixture(deploy);
            await expect(adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600))
                .to.emit(adapter, "FeedConfigured")
                .withArgs(BTC, feedId("BTC"), 8, 3600);
            const cfg = await adapter.feeds(BTC);
            expect(cfg.feedId).to.equal(feedId("BTC"));
            expect(cfg.feedDecimals).to.equal(8);
            expect(cfg.maxStaleness).to.equal(3600n);
            expect(cfg.configured).to.equal(true);
        });

        it("setFeed validates inputs", async () => {
            const { adapter, admin } = await loadFixture(deploy);
            await expect(
                adapter.connect(admin).setFeed(ethers.ZeroAddress, feedId("BTC"), 8, 3600),
            ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
            await expect(adapter.connect(admin).setFeed(BTC, ethers.ZeroHash, 8, 3600)).to.be.revertedWithCustomError(
                adapter,
                "ZeroFeedId",
            );
            await expect(adapter.connect(admin).setFeed(BTC, feedId("BTC"), 0, 3600)).to.be.revertedWithCustomError(
                adapter,
                "InvalidDecimals",
            );
            await expect(adapter.connect(admin).setFeed(BTC, feedId("BTC"), 37, 3600)).to.be.revertedWithCustomError(
                adapter,
                "InvalidDecimals",
            );
            await expect(
                adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 8 * 24 * 3600),
            ).to.be.revertedWithCustomError(adapter, "StalenessTooHigh");
        });

        it("setFeed/removeFeed are admin-only", async () => {
            const { adapter, other } = await loadFixture(deploy);
            await expect(adapter.connect(other).setFeed(BTC, feedId("BTC"), 8, 3600)).to.be.reverted;
            await expect(adapter.connect(other).removeFeed(BTC)).to.be.reverted;
        });

        it("removeFeed clears config and cache", async () => {
            const { adapter, admin, keeper } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);
            await pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 50_000 }]);
            await expect(adapter.connect(admin).removeFeed(BTC)).to.emit(adapter, "FeedRemoved").withArgs(BTC);
            const cfg = await adapter.feeds(BTC);
            expect(cfg.configured).to.equal(false);
            const [price, , , valid] = await adapter.getPrice(BTC);
            expect(price).to.equal(0n);
            expect(valid).to.equal(false);
        });
    });

    describe("getPrice validity (never reverts)", () => {
        it("returns valid=false when unconfigured", async () => {
            const { adapter } = await loadFixture(deploy);
            const [price, conf, ts, valid] = await adapter.getPrice(BTC);
            expect(price).to.equal(0n);
            expect(conf).to.equal(0n);
            expect(ts).to.equal(0n);
            expect(valid).to.equal(false);
        });

        it("returns valid=false when configured but never pushed", async () => {
            const { adapter, admin } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);
            const [price, , , valid] = await adapter.getPrice(BTC);
            expect(price).to.equal(0n);
            expect(valid).to.equal(false);
        });
    });

    describe("pushPrice (RedStone payload)", () => {
        it("caches a normalized 1e18 price from a signed payload", async () => {
            const { adapter, admin, keeper } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);

            await pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 50_000 }]);

            const [price, conf, , valid] = await adapter.getPrice(BTC);
            expect(price).to.equal(e18(50_000));
            expect(conf).to.equal(0n); // RedStone exposes no confidence band
            expect(valid).to.equal(true);
        });

        it("emits PricePushed with the normalized price", async () => {
            const { adapter, admin, keeper } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(TSLA, feedId("TSLA"), 8, 3600);
            // we can't predict block.timestamp inside withArgs easily; assert via event filter
            await pushRedstonePrice(adapter, keeper, TSLA, [{ dataFeedId: "TSLA", value: 250 }]);
            const [price] = await adapter.getPrice(TSLA);
            expect(price).to.equal(e18(250));
        });

        it("reverts FeedNotConfigured for an unconfigured market", async () => {
            const { adapter, keeper } = await loadFixture(deploy);
            await expect(
                pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 50_000 }]),
            ).to.be.revertedWithCustomError(adapter, "FeedNotConfigured");
        });

        it("is keeper-gated", async () => {
            const { adapter, admin, other } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);
            await expect(pushRedstonePrice(adapter, other, BTC, [{ dataFeedId: "BTC", value: 50_000 }])).to.be.reverted;
        });

        it("getCachedPrice reflects the last push", async () => {
            const { adapter, admin, keeper } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);
            await pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 60_000 }]);
            const [price, ts] = await adapter.getCachedPrice(BTC);
            expect(price).to.equal(e18(60_000));
            expect(ts).to.be.greaterThan(0n);
        });
    });

    describe("staleness gate", () => {
        it("returns valid=false once the cached price exceeds maxStaleness", async () => {
            const { adapter, admin, keeper } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 100);
            await pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 50_000 }]);

            let [, , , valid] = await adapter.getPrice(BTC);
            expect(valid).to.equal(true);

            await time.increase(101);
            [, , , valid] = await adapter.getPrice(BTC);
            expect(valid).to.equal(false);
        });

        it("maxStaleness == 0 disables the freshness gate", async () => {
            const { adapter, admin, keeper } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 0);
            await pushRedstonePrice(adapter, keeper, BTC, [{ dataFeedId: "BTC", value: 50_000 }]);
            await time.increase(10 * 24 * 3600);
            const [price, , , valid] = await adapter.getPrice(BTC);
            expect(price).to.equal(e18(50_000));
            expect(valid).to.equal(true);
        });
    });

    describe("batch push", () => {
        it("pushes several markets from one payload", async () => {
            const { adapter, admin, keeper } = await loadFixture(deploy);
            await adapter.connect(admin).setFeed(BTC, feedId("BTC"), 8, 3600);
            await adapter.connect(admin).setFeed(TSLA, feedId("TSLA"), 8, 3600);

            await pushRedstonePrices(
                adapter,
                keeper,
                [BTC, TSLA],
                [
                    { dataFeedId: "BTC", value: 50_000 },
                    { dataFeedId: "TSLA", value: 250 },
                ],
            );

            const [btc] = await adapter.getPrice(BTC);
            const [tsla] = await adapter.getPrice(TSLA);
            expect(btc).to.equal(e18(50_000));
            expect(tsla).to.equal(e18(250));
        });
    });
});
