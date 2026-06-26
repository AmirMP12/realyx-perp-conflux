import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { setPythPrice, PYTH_EXPO } from "../helpers/pyth";
import { OPERATOR_ROLE, ORACLE_ROLE, GUARDIAN_ROLE, KEEPER_ROLE } from "../helpers/constants";

const FEED = ethers.zeroPadValue("0x0abc", 32);
const FEED_B = ethers.zeroPadValue("0x0bcd", 32);
const ETH_FEED = ethers.zeroPadValue("0x0e7e", 32);
const MARKET = "0x00000000000000000000000000000000000000B7";
const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, operator, oracleBot, guardian, g2, g3, keeper, other] = await ethers.getSigners();
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
    await oracle.grantRole(ORACLE_ROLE, oracleBot.address);
    await oracle.grantRole(GUARDIAN_ROLE, guardian.address);
    await oracle.grantRole(GUARDIAN_ROLE, g2.address);
    await oracle.grantRole(GUARDIAN_ROLE, g3.address);
    await oracle.grantRole(KEEPER_ROLE, keeper.address);

    return { oracle, pyth, admin, operator, oracleBot, guardian, g2, g3, keeper, other };
}

/**
 * Push a fully-custom raw Pyth update (raw int64 price, raw uint64 conf, expo)
 * directly through MockPyth so tests can exercise normalization edge cases
 * that the higher-level `setPythPrice` helper (fixed expo / positive price)
 * cannot reach.
 */
async function pushRaw(
    pyth: any,
    feedId: string,
    rawPrice: bigint,
    rawConf: bigint,
    expo: number,
    publishTime?: number,
) {
    const block = await ethers.provider.getBlock("latest");
    const t = publishTime ?? block!.timestamp;
    const data = await pyth.createPriceFeedUpdateData(feedId, rawPrice, rawConf, expo, rawPrice, rawConf, t, 0);
    const fee = await pyth.getUpdateFee([data]);
    await pyth.updatePriceFeeds([data], { value: fee });
}

describe("OracleAggregator — price validation guards", () => {
    describe("price-view staleness / validity guards", () => {
        it("uses defaultMaxStaleness when feed maxStaleness == 0", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            // maxStaleness = 0 -> falls back to defaultMaxStaleness (15m)
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 0, 10n ** 15n);
            await setPythPrice(pyth, FEED, e18(50_000));
            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
            // isOracleHealthy also takes the maxStaleness==0 fallback
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(1n);
            const [healthy] = await oracle.isOracleHealthy(MARKET);
            expect(healthy).to.equal(true);
        });

        it("reverts InvalidSource when the raw Pyth price is zero", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            await pushRaw(pyth, FEED, 0n, 0n, PYTH_EXPO);
            await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "InvalidSource");
        });

        it("isOracleHealthy reports Invalid price for a non-positive price", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            await pushRaw(pyth, FEED, 0n, 0n, PYTH_EXPO);
            const [healthy, reason] = await oracle.isOracleHealthy(MARKET);
            expect(healthy).to.equal(false);
            expect(reason).to.equal("Invalid price");
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(0n);
        });

        it("reverts InvalidSource when a positive raw price normalizes to zero", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            // raw price = 1, expo = -30 -> normalized = 1 / 1e12 = 0
            await pushRaw(pyth, FEED, 1n, 0n, -30);
            await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "InvalidSource");
        });

        it("accepts a zero confidence band", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            // normal positive price, but confidence pushed as exactly zero
            await setPythPrice(pyth, FEED, e18(50_000), 0n);
            const [p, conf] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
            expect(conf).to.equal(0n);
        });
    });

    describe("normalization with deep-negative exponents", () => {
        it("confidence floors to 1 when it would round to zero", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            // expo = -20 -> decimalDiff = -2, so price and conf are both
            // divided down. raw conf = 50 -> 50/100 = 0 -> floored to 1.
            await pushRaw(pyth, FEED, 5n * 10n ** 17n, 50n, -20);
            const [p, conf] = await oracle.getPrice(MARKET);
            expect(p).to.equal(5n * 10n ** 15n); // 5e17 / 100
            expect(conf).to.equal(1n); // floored
        });

        it("confidence keeps its value when non-zero after division", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            // raw conf = 500 -> 500/100 = 5 (non-zero, not floored)
            await pushRaw(pyth, FEED, 5n * 10n ** 17n, 500n, -20);
            const [p, conf] = await oracle.getPrice(MARKET);
            expect(p).to.equal(5n * 10n ** 15n);
            expect(conf).to.equal(5n);
        });
    });

    describe("ETH/USD feed validity", () => {
        it("reverts InvalidSource when ETH feed reports a non-positive price", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setEthFeedId(ETH_FEED);
            await pushRaw(pyth, ETH_FEED, 0n, 0n, PYTH_EXPO);
            await expect(oracle.getEthUsdPrice()).to.be.revertedWithCustomError(oracle, "InvalidSource");
        });
    });

    describe("manual emergency price override active (deterministic via staged apply)", () => {
        async function activateManual(ctx: any, price: bigint) {
            const { oracle, admin, guardian, g2, g3, pyth } = ctx;
            await oracle.connect(operatorOrAdmin(ctx)).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            await setPythPrice(pyth, FEED, e18(50_000));
            await oracle.connect(admin).setEmergencyPriceQuorum(3);
            const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
            // ~2% deviation -> below 5% cap, above 1% fast-track -> stages pending
            const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, price, validUntil);
            const rc = await tx.wait();
            const proposalId = rc!.logs
                .map((l: any) => {
                    try {
                        return oracle.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.args && p.args.proposalId !== undefined)?.args?.proposalId;
            await oracle.connect(g2).confirmEmergencyPrice(proposalId);
            await oracle.connect(g3).confirmEmergencyPrice(proposalId);
            await time.increase(24 * 60 * 60 + 1);
            await setPythPrice(pyth, FEED, price); // refresh spot so apply-time re-check passes
            await oracle.applyPendingEmergencyPrice(MARKET);
            expect(await oracle.isManualPriceActive(MARKET)).to.equal(true);
        }
        function operatorOrAdmin(ctx: any) {
            return ctx.operator;
        }

        it("getPrice returns the manual override while active", async () => {
            const ctx = await loadFixture(deploy);
            await activateManual(ctx, e18(51_000));
            const [p, conf] = await ctx.oracle.getPrice(MARKET);
            expect(p).to.equal(e18(51_000));
            expect(conf).to.equal(e18(1)); // PRECISION confidence for manual
        });

        it("recordPricePoint is a no-op while a manual override is active", async () => {
            const ctx = await loadFixture(deploy);
            await activateManual(ctx, e18(51_000));
            // should silently return without seeding the buffer
            await ctx.oracle.connect(ctx.oracleBot).recordPricePoint(MARKET, 0);
            const twap = await ctx.oracle.getTWAP(MARKET, 900);
            expect(twap).to.equal(e18(51_000)); // empty buffer -> manual spot
        });

        it("admin clearManualPrice revokes an active override and restores the Pyth read", async () => {
            const ctx = await loadFixture(deploy);
            await activateManual(ctx, e18(51_000));
            const { oracle, admin } = ctx;
            const [mp, exp] = await oracle.getManualPrice(MARKET);
            expect(mp).to.equal(e18(51_000));
            expect(exp).to.be.greaterThan(0n);

            await expect(oracle.connect(admin).clearManualPrice(MARKET)).to.emit(oracle, "ManualPriceCleared");
            expect(await oracle.isManualPriceActive(MARKET)).to.equal(false);
            const [mpAfter] = await oracle.getManualPrice(MARKET);
            expect(mpAfter).to.equal(0n);
            // getPrice now falls back to the live Pyth feed (51_000 refreshed in helper)
            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(51_000));
        });

        it("clearManualPrice rejects a non-admin caller", async () => {
            const ctx = await loadFixture(deploy);
            await activateManual(ctx, e18(51_000));
            await expect(ctx.oracle.connect(ctx.other).clearManualPrice(MARKET)).to.be.reverted;
            expect(await ctx.oracle.isManualPriceActive(MARKET)).to.equal(true);
        });
    });

    describe("getPriceWithConfidence fraction comparison", () => {
        it("returns the price when confidence fraction is within the cap", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            await setPythPrice(pyth, FEED, e18(50_000)); // default conf band 1e14, tiny fraction
            const p = await oracle.getPriceWithConfidence(MARKET, e18(1)); // 100% tolerance
            expect(p).to.equal(e18(50_000));
        });

        it("reverts InsufficientConfidence when the fraction exceeds maxUncertainty", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            // generous feed maxConfidence so the read passes the absolute gate
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, ethers.MaxUint256 & ((1n << 64n) - 1n));
            // conf band 1e16 on a 50k price -> fraction = 1e16*1e18/50000e18 = 2e11, tiny.
            // Use a near-zero maxUncertainty so even a tiny fraction exceeds it.
            await setPythPrice(pyth, FEED, e18(50_000), 10n ** 16n);
            await expect(
                oracle.getPriceWithConfidence(MARKET, 1n),
            ).to.be.revertedWithCustomError(oracle, "InsufficientConfidence");
        });
    });

    describe("updatePrices fee/refund handling", () => {
        it("pushes a real update and refunds the overpayment", async () => {
            const { oracle, operator, pyth, other } = await loadFixture(deploy);
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            const block = await ethers.provider.getBlock("latest");
            const data = await pyth.createPriceFeedUpdateData(
                FEED,
                5n * 10n ** 12n, // raw price for 50_000 at expo -8
                10n ** 6n,
                PYTH_EXPO,
                5n * 10n ** 12n,
                10n ** 6n,
                block!.timestamp + 1,
                0,
            );
            const fee = await pyth.getUpdateFee([data]);
            // overpay by 100 wei so the refund path returns the overpayment
            const refund = await oracle
                .connect(other)
                .updatePrices.staticCall([data], { value: fee + 100n });
            expect(refund).to.equal(100n);
            await oracle.connect(other).updatePrices([data], { value: fee + 100n });
        });

        it("reverts InsufficientUpdateFee when msg.value < fee", async () => {
            const { oracle, pyth, other } = await loadFixture(deploy);
            const block = await ethers.provider.getBlock("latest");
            const data = await pyth.createPriceFeedUpdateData(
                FEED,
                5n * 10n ** 12n,
                10n ** 6n,
                PYTH_EXPO,
                5n * 10n ** 12n,
                10n ** 6n,
                block!.timestamp + 1,
                0,
            );
            await expect(
                oracle.connect(other).updatePrices([data], { value: 0 }),
            ).to.be.revertedWithCustomError(oracle, "InsufficientUpdateFee");
        });
    });

    describe("global-pause expiry", () => {
        it("deactivateGlobalPause is a no-op when not paused", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await oracle.connect(admin).deactivateGlobalPause(); // no revert, _globalPause false
            expect(await oracle.isGloballyPaused()).to.equal(false);
        });

        it("expireGlobalPause is a no-op within the window, then expires after it", async () => {
            const { oracle, guardian } = await loadFixture(deploy);
            await oracle.connect(guardian).activateGlobalPause();
            expect(await oracle.isGloballyPaused()).to.equal(true);
            // within GLOBAL_PAUSE_AUTO_EXPIRY -> early return at the time check
            await oracle.expireGlobalPause();
            expect(await oracle.isGloballyPaused()).to.equal(true);
            // past the auto-expiry window -> actually clears
            await time.increase(6 * 60 * 60 + 1);
            await oracle.expireGlobalPause();
            expect(await oracle.isGloballyPaused()).to.equal(false);
        });
    });

    describe("feed rotation timelock", () => {
        it("rejects a mismatched/un-staged rotation then enforces the timelock", async () => {
            const { oracle, operator } = await loadFixture(deploy);
            // first-time config is immediate
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            // repoint to a DIFFERENT feed with nothing staged -> PendingFeedMismatch
            await expect(
                oracle.connect(operator).setPythFeed(MARKET, FEED_B, 900, 10n ** 15n),
            ).to.be.revertedWithCustomError(oracle, "PendingFeedMismatch");
            // stage the rotation, then try to apply immediately -> FeedTimelockActive
            await oracle.connect(operator).proposePythFeed(MARKET, FEED_B, 900, 10n ** 15n);
            await expect(
                oracle.connect(operator).setPythFeed(MARKET, FEED_B, 900, 10n ** 15n),
            ).to.be.revertedWithCustomError(oracle, "FeedTimelockActive");
            // after the 24h timelock it applies
            await time.increase(24 * 60 * 60 + 1);
            await oracle.connect(operator).setPythFeed(MARKET, FEED_B, 900, 10n ** 15n);
            const [feedId] = await oracle.getOracleConfig(MARKET);
            expect(feedId).to.equal(FEED_B);
        });
    });
});
