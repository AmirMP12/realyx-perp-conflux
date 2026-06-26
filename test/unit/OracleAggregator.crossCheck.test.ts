import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { setPythPrice } from "../helpers/pyth";
import { feedId, pushRedstonePrice } from "../helpers/redstone";
import { OPERATOR_ROLE } from "../helpers/constants";

const PYTH_FEED = ethers.zeroPadValue("0x0abc", 32);
const MARKET = "0x00000000000000000000000000000000000000b7";
const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const REDSTONE_KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REDSTONE_KEEPER_ROLE"));

async function deploy() {
    const [admin, operator, keeper, other] = await ethers.getSigners();

    const MockPyth = await ethers.getContractFactory("MockPythWrapper");
    const pyth = await MockPyth.deploy(3600, 1);
    await pyth.waitForDeployment();

    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    const oracle = await upgrades.deployProxy(OracleAggregator, [admin.address, await pyth.getAddress()], {
        kind: "uups",
        initializer: "initialize",
    });
    await oracle.waitForDeployment();
    await oracle.grantRole(OPERATOR_ROLE, operator.address);

    // Secondary source: RedStone adapter harness (accepts mock-signed payloads).
    const Harness = await ethers.getContractFactory("RedStoneAdapterHarness");
    const adapter = await Harness.deploy(admin.address);
    await adapter.waitForDeployment();
    await adapter.grantRole(REDSTONE_KEEPER_ROLE, keeper.address);

    // Configure the same market on both sources.
    await oracle.connect(operator).setPythFeed(MARKET, PYTH_FEED, 900, 10n ** 15n);
    await adapter.connect(admin).setFeed(MARKET, feedId("BTC"), 8, 3600);

    return { oracle, pyth, adapter, admin, operator, keeper, other };
}

describe("OracleAggregator — secondary source cross-check", () => {
    describe("setters & access control", () => {
        it("setSecondarySource is admin-only and emits", async () => {
            const { oracle, admin, adapter, other } = await loadFixture(deploy);
            await expect(oracle.connect(other).setSecondarySource(await adapter.getAddress())).to.be.reverted;
            await expect(oracle.connect(admin).setSecondarySource(await adapter.getAddress()))
                .to.emit(oracle, "SecondarySourceUpdated")
                .withArgs(await adapter.getAddress());
            expect(await oracle.secondarySource()).to.equal(await adapter.getAddress());
        });

        it("setCrossSourceMaxDeviationBps is admin-only and capped at 5000", async () => {
            const { oracle, admin, other } = await loadFixture(deploy);
            await expect(oracle.connect(other).setCrossSourceMaxDeviationBps(200)).to.be.reverted;
            await expect(oracle.connect(admin).setCrossSourceMaxDeviationBps(5001)).to.be.revertedWithCustomError(
                oracle,
                "DeviationTooHigh",
            );
            await expect(oracle.connect(admin).setCrossSourceMaxDeviationBps(200))
                .to.emit(oracle, "CrossSourceMaxDeviationUpdated")
                .withArgs(200);
            expect(await oracle.crossSourceMaxDeviationBps()).to.equal(200n);
        });

        it("setCrossCheckEnabled is operator-only and emits", async () => {
            const { oracle, operator, other } = await loadFixture(deploy);
            await expect(oracle.connect(other).setCrossCheckEnabled(MARKET, true)).to.be.reverted;
            await expect(oracle.connect(operator).setCrossCheckEnabled(MARKET, true))
                .to.emit(oracle, "CrossCheckConfigured")
                .withArgs(MARKET, true);
            expect(await oracle.crossCheckEnabled(MARKET)).to.equal(true);
        });
    });

    describe("default behavior unchanged when no secondary is wired", () => {
        it("getPrice returns the Pyth price and getValidSourceCount is 1", async () => {
            const { oracle, pyth } = await loadFixture(deploy);
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));
            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(1n);
        });
    });

    describe("cross-source deviation guard", () => {
        async function wire(ctx: any, maxDevBps: number) {
            const { oracle, admin, operator, adapter } = ctx;
            await oracle.connect(admin).setSecondarySource(await adapter.getAddress());
            await oracle.connect(admin).setCrossSourceMaxDeviationBps(maxDevBps);
            await oracle.connect(operator).setCrossCheckEnabled(MARKET, true);
        }

        it("serves the price when the two sources agree within tolerance", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, pyth, adapter, keeper } = ctx;
            await wire(ctx, 200); // 2%
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));
            await pushRedstonePrice(adapter, keeper, MARKET, [{ dataFeedId: "BTC", value: 50_250 }]); // +0.5%

            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(2n);
        });

        it("reverts DeviationTooHigh when the sources disagree beyond tolerance", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, pyth, adapter, keeper } = ctx;
            await wire(ctx, 200); // 2%
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));
            await pushRedstonePrice(adapter, keeper, MARKET, [{ dataFeedId: "BTC", value: 55_000 }]); // +10%

            await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "DeviationTooHigh");
        });

        it("deviation is measured against the smaller price (conservative)", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, pyth, adapter, keeper } = ctx;
            // 300 bps tolerance. Pyth 50_000, secondary 48_500 => diff 1_500.
            // vs smaller (48_500): 1500/48500 = 3.09% > 3% => revert.
            await wire(ctx, 300);
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));
            await pushRedstonePrice(adapter, keeper, MARKET, [{ dataFeedId: "BTC", value: 48_500 }]);
            await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "DeviationTooHigh");
        });
    });

    describe("graceful degradation to single source", () => {
        it("no revert when the market has not opted in, even on a large gap", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, admin, pyth, adapter, keeper } = ctx;
            await oracle.connect(admin).setSecondarySource(await adapter.getAddress());
            await oracle.connect(admin).setCrossSourceMaxDeviationBps(200);
            // crossCheckEnabled stays false for MARKET
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));
            await pushRedstonePrice(adapter, keeper, MARKET, [{ dataFeedId: "BTC", value: 99_000 }]);

            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(1n);
        });

        it("no revert when the deviation guard is disabled (bps == 0)", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, admin, operator, pyth, adapter, keeper } = ctx;
            await oracle.connect(admin).setSecondarySource(await adapter.getAddress());
            await oracle.connect(operator).setCrossCheckEnabled(MARKET, true);
            // crossSourceMaxDeviationBps stays 0
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));
            await pushRedstonePrice(adapter, keeper, MARKET, [{ dataFeedId: "BTC", value: 99_000 }]);

            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
        });

        it("falls back to single source when the secondary is stale", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, admin, operator, pyth, adapter, keeper } = ctx;
            // tight secondary staleness
            await adapter.connect(admin).setFeed(MARKET, feedId("BTC"), 8, 100);
            await oracle.connect(admin).setSecondarySource(await adapter.getAddress());
            await oracle.connect(admin).setCrossSourceMaxDeviationBps(200);
            await oracle.connect(operator).setCrossCheckEnabled(MARKET, true);

            await setPythPrice(pyth, PYTH_FEED, e18(50_000));
            await pushRedstonePrice(adapter, keeper, MARKET, [{ dataFeedId: "BTC", value: 99_000 }]);

            // While fresh, the gap would revert; advance past secondary staleness so it is ignored.
            await time.increase(101);
            // refresh Pyth so its own staleness gate still passes
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));

            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(1n);
        });

        it("falls back to single source when the secondary has no price for the market", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, admin, operator, pyth } = ctx;
            await oracle.connect(admin).setSecondarySource(await admin.getAddress()); // EOA: getPrice call reverts
            await oracle.connect(admin).setCrossSourceMaxDeviationBps(200);
            await oracle.connect(operator).setCrossCheckEnabled(MARKET, true);
            await setPythPrice(pyth, PYTH_FEED, e18(50_000));

            // try/catch around the secondary read swallows the failure -> single source
            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(1n);
        });
    });
});
