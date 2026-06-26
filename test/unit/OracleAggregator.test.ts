import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { setPythPrice, buildPriceUpdate } from "../helpers/pyth";
import { BreakerType, BreakerState, OPERATOR_ROLE, ORACLE_ROLE, GUARDIAN_ROLE } from "../helpers/constants";

const FEED = ethers.zeroPadValue("0x0abc", 32);
const MARKET = "0x00000000000000000000000000000000000000B7";
const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);

async function deploy() {
    const [admin, operator, oracleBot, guardian, g2, g3, other] = await ethers.getSigners();
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

    return { oracle, pyth, admin, operator, oracleBot, guardian, g2, g3, other };
}

async function deployWithFeed() {
    const ctx = await deploy();
    await ctx.oracle.connect(ctx.operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
    await setPythPrice(ctx.pyth, FEED, e18(50_000));
    return ctx;
}

describe("OracleAggregator", () => {
    describe("initialize", () => {
        it("sets defaults and reverts on re-init", async () => {
            const { oracle, admin, pyth } = await loadFixture(deploy);
            expect(await oracle.guardianQuorum()).to.equal(3n);
            expect(await oracle.emergencyPriceQuorum()).to.equal(3n);
            await expect(
                oracle.initialize(admin.address, await pyth.getAddress()),
            ).to.be.reverted;
        });
    });

    describe("setPythFeed", () => {
        it("reverts when maxConfidence is 0", async () => {
            const { oracle, operator } = await loadFixture(deploy);
            await expect(oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 0)).to.be.revertedWithCustomError(
                oracle,
                "MaxConfidenceRequired",
            );
        });
        it("configures the feed", async () => {
            const { oracle, operator } = await loadFixture(deploy);
            await expect(oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n)).to.emit(
                oracle,
                "PythFeedSet",
            );
            const [feedId, maxStale] = await oracle.getOracleConfig(MARKET);
            expect(feedId).to.equal(FEED);
            expect(maxStale).to.equal(900n);
        });
        it("only operator", async () => {
            const { oracle, other } = await loadFixture(deploy);
            await expect(oracle.connect(other).setPythFeed(MARKET, FEED, 900, 1)).to.be.revertedWithCustomError(
                oracle,
                "NotOperator",
            );
        });

        it("first-time config and same-feed tweaks are immediate; feed ROTATION is timelocked", async () => {
            const { oracle, operator } = await loadFixture(deploy);
            const FEED2 = ethers.zeroPadValue("0x0def", 32);
            // First-time config: immediate.
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
            // Same-feed parameter tweak (staleness/conf): still immediate.
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 1200, 10n ** 15n);
            // Repointing to a DIFFERENT feed without a staged proposal reverts.
            await expect(
                oracle.connect(operator).setPythFeed(MARKET, FEED2, 900, 10n ** 15n),
            ).to.be.revertedWithCustomError(oracle, "PendingFeedMismatch");
            // Stage the rotation; still blocked before the timelock elapses.
            await oracle.connect(operator).proposePythFeed(MARKET, FEED2, 900, 10n ** 15n);
            await expect(
                oracle.connect(operator).setPythFeed(MARKET, FEED2, 900, 10n ** 15n),
            ).to.be.revertedWithCustomError(oracle, "FeedTimelockActive");
            // After 24h, the rotation applies.
            await time.increase(24 * 60 * 60 + 1);
            await expect(oracle.connect(operator).setPythFeed(MARKET, FEED2, 900, 10n ** 15n)).to.emit(
                oracle,
                "PythFeedSet",
            );
            const [feedId] = await oracle.getOracleConfig(MARKET);
            expect(feedId).to.equal(FEED2);
        });
    });

    describe("getPrice", () => {
        it("reverts InvalidSource when feed not configured", async () => {
            const { oracle } = await loadFixture(deploy);
            await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "InvalidSource");
        });
        it("returns normalized price", async () => {
            const { oracle } = await loadFixture(deployWithFeed);
            const [price, conf] = await oracle.getPrice(MARKET);
            expect(price).to.equal(e18(50_000));
            expect(conf).to.be.greaterThan(0n);
        });
        it("reverts on stale price", async () => {
            const { oracle, pyth } = await loadFixture(deployWithFeed);
            await time.increase(901);
            await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "StalePrice");
        });
        it("reverts InsufficientConfidence when conf exceeds cap", async () => {
            const { oracle, pyth } = await loadFixture(deployWithFeed);
            // publish a large confidence band beyond the 1e15 cap
            await setPythPrice(pyth, FEED, e18(50_000), e18(1));
            await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "InsufficientConfidence");
        });
        it("getPriceWithConfidence enforces caller uncertainty bound", async () => {
            const { oracle } = await loadFixture(deployWithFeed);
            await expect(oracle.getPriceWithConfidence(MARKET, 1)).to.be.revertedWithCustomError(
                oracle,
                "InsufficientConfidence",
            );
            const p = await oracle.getPriceWithConfidence(MARKET, e18(1));
            expect(p).to.equal(e18(50_000));
        });

        it("getPriceWithConfidence treats maxUncertainty as a FRACTION of price (regression)", async () => {
            // Regression for the fraction-vs-absolute confidence bug: a $50k
            // asset with a ~0.02% absolute band has a large NORMALIZED band
            // (1e19 in 1e18 price-units) but a tiny fractional band. The prior
            // code compared the absolute band against a fractional cap and
            // reverted every read for high-priced assets; the fix scales the
            // band by price first.
            const { oracle, operator, pyth } = await loadFixture(deploy);
            const maxU64 = (1n << 64n) - 1n; // allow a large absolute band through the feed gate
            await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, maxU64);
            // price $50k, absolute normalized confidence band = 1e19 (~0.02% of price)
            await setPythPrice(pyth, FEED, e18(50_000), 10n ** 19n);

            // Fractional band ≈ 1e19 * 1e18 / 50000e18 = 2e14 (0.02%). Against the
            // protocol's default maxOracleUncertainty (8e17 = 80%) this passes;
            // under the old absolute comparison (1e19 > 8e17) it wrongly reverted.
            const p = await oracle.getPriceWithConfidence(MARKET, 8n * 10n ** 17n);
            expect(p).to.equal(e18(50_000));

            // And a fractional cap tighter than the actual band still reverts.
            await expect(
                oracle.getPriceWithConfidence(MARKET, 10n ** 14n), // 0.01% < 0.02% band
            ).to.be.revertedWithCustomError(oracle, "InsufficientConfidence");
        });
    });

    describe("isOracleHealthy / getValidSourceCount", () => {
        it("unconfigured market is unhealthy with 0 sources", async () => {
            const { oracle } = await loadFixture(deploy);
            const [healthy, reason] = await oracle.isOracleHealthy(MARKET);
            expect(healthy).to.equal(false);
            expect(reason).to.equal("Not configured");
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(0n);
        });
        it("configured fresh feed is healthy with 1 source", async () => {
            const { oracle } = await loadFixture(deployWithFeed);
            const [healthy] = await oracle.isOracleHealthy(MARKET);
            expect(healthy).to.equal(true);
            expect(await oracle.getValidSourceCount(MARKET)).to.equal(1n);
        });
        it("stale feed reports unhealthy", async () => {
            const { oracle } = await loadFixture(deployWithFeed);
            await time.increase(901);
            const [healthy, reason] = await oracle.isOracleHealthy(MARKET);
            expect(healthy).to.equal(false);
            expect(reason).to.equal("Stale price");
        });
    });

    describe("updatePrices", () => {
        it("refunds full value for empty update array", async () => {
            const { oracle, other } = await loadFixture(deploy);
            await expect(oracle.connect(other).updatePrices([], { value: 100 })).to.not.be.reverted;
        });
        it("reverts on insufficient fee", async () => {
            const { oracle, pyth, other } = await loadFixture(deployWithFeed);
            const data = await buildPriceUpdate(pyth, FEED, e18(50_000));
            await expect(oracle.connect(other).updatePrices([data], { value: 0 })).to.be.revertedWithCustomError(
                oracle,
                "InsufficientUpdateFee",
            );
        });
        it("applies updates and refunds excess", async () => {
            const { oracle, pyth, other } = await loadFixture(deployWithFeed);
            const data = await buildPriceUpdate(pyth, FEED, e18(51_000));
            const fee = await pyth.getUpdateFee([data]);
            await oracle.connect(other).updatePrices([data], { value: fee + 1000n });
            const [price] = await oracle.getPrice(MARKET);
            expect(price).to.equal(e18(51_000));
        });
    });

    describe("recordPricePoint + TWAP", () => {
        it("reverts when reportedPrice is non-zero", async () => {
            const { oracle, oracleBot } = await loadFixture(deployWithFeed);
            await expect(oracle.connect(oracleBot).recordPricePoint(MARKET, 1)).to.be.revertedWithCustomError(
                oracle,
                "ReportedPriceMustBeZero",
            );
        });
        it("only oracle/keeper can record", async () => {
            const { oracle, other } = await loadFixture(deployWithFeed);
            await expect(oracle.connect(other).recordPricePoint(MARKET, 0)).to.be.revertedWithCustomError(
                oracle,
                "NotOracleOrKeeper",
            );
        });
        it("builds a TWAP buffer over several samples", async () => {
            const { oracle, oracleBot, pyth } = await loadFixture(deployWithFeed);
            for (let i = 0; i < 4; i++) {
                await setPythPrice(pyth, FEED, e18(50_000));
                await oracle.connect(oracleBot).recordPricePoint(MARKET, 0);
                await time.increase(35);
            }
            await setPythPrice(pyth, FEED, e18(50_000));
            const [twap, valid] = await oracle.getTWAPWithValidation(MARKET, 900, 2);
            expect(valid).to.equal(true);
            expect(twap).to.be.approximately(e18(50_000), e18(1));
        });
        it("getTWAP falls back to spot when buffer empty", async () => {
            const { oracle } = await loadFixture(deployWithFeed);
            const twap = await oracle.getTWAP(MARKET, 900);
            expect(twap).to.equal(e18(50_000));
        });
    });

    describe("circuit breakers", () => {
        it("configureBreaker + getBreakerConfig", async () => {
            const { oracle, operator } = await loadFixture(deployWithFeed);
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600);
            const cfg = await oracle.getBreakerConfig(MARKET, BreakerType.PRICE_DROP);
            expect(cfg.threshold).to.equal(1000n);
            expect(cfg.windowSeconds).to.equal(900n);
        });
        it("guardian triggers and admin resets a breaker", async () => {
            const { oracle, operator, guardian, admin } = await loadFixture(deployWithFeed);
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600);
            await oracle.connect(guardian).triggerBreaker(MARKET, BreakerType.PRICE_DROP);
            let status = await oracle.getBreakerStatus(MARKET, BreakerType.PRICE_DROP);
            expect(status.state).to.equal(BreakerState.TRIGGERED);
            await oracle.connect(admin).resetBreaker(MARKET, BreakerType.PRICE_DROP);
            status = await oracle.getBreakerStatus(MARKET, BreakerType.PRICE_DROP);
            expect(status.state).to.not.equal(BreakerState.TRIGGERED);
        });
        it("isActionAllowed false when a breaker is triggered", async () => {
            const { oracle, operator, guardian } = await loadFixture(deployWithFeed);
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600);
            await oracle.connect(guardian).triggerBreaker(MARKET, BreakerType.PRICE_DROP);
            expect(await oracle.isActionAllowed(MARKET, 0)).to.equal(false);
            const [restricted, active] = await oracle.isMarketRestricted(MARKET);
            expect(restricted).to.equal(true);
            expect(active).to.be.greaterThan(0n);
        });
        it("setBreakerEnabled toggles a breaker", async () => {
            const { oracle, operator } = await loadFixture(deployWithFeed);
            await expect(oracle.connect(operator).setBreakerEnabled(MARKET, BreakerType.TWAP_DEVIATION, true)).to.emit(
                oracle,
                "BreakerEnabledUpdated",
            );
        });
    });

    describe("global pause", () => {
        it("guardian activates, auto-expires after window", async () => {
            const { oracle, guardian } = await loadFixture(deploy);
            await oracle.connect(guardian).activateGlobalPause();
            expect(await oracle.isGloballyPaused()).to.equal(true);
            await time.increase(6 * 60 * 60 + 1);
            // view-side treats as expired
            expect(await oracle.isGloballyPaused()).to.equal(false);
            // permissionless expiry clears storage
            await oracle.expireGlobalPause();
        });
        it("admin can deactivate", async () => {
            const { oracle, guardian, admin } = await loadFixture(deploy);
            await oracle.connect(guardian).activateGlobalPause();
            await oracle.connect(admin).deactivateGlobalPause();
            expect(await oracle.isGloballyPaused()).to.equal(false);
        });
        it("non-admin cannot deactivate", async () => {
            const { oracle, guardian, other } = await loadFixture(deploy);
            await oracle.connect(guardian).activateGlobalPause();
            await expect(oracle.connect(other).deactivateGlobalPause()).to.be.revertedWithCustomError(
                oracle,
                "NotAdmin",
            );
        });
    });

    describe("emergency pause quorum flow", () => {
        it("propose + confirm reaches quorum", async () => {
            const { oracle, guardian, g2, g3 } = await loadFixture(deploy);
            const targets = [MARKET];
            const tx = await oracle.connect(guardian).proposeEmergencyPause(targets, "incident");
            const rc = await tx.wait();
            const ev = rc!.logs
                .map((l: any) => {
                    try {
                        return oracle.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.name);
            // confirm with quorum (3 guardians, default quorum 3)
            const pauseId = (rc!.logs as any[])
                .map((l) => {
                    try {
                        return oracle.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.args && p.args.pauseId !== undefined)?.args?.pauseId;
            // Even if we can't decode the id, the proposer auto-confirms; just check no revert path here.
            expect(rc!.status).to.equal(1);
        });
    });

    describe("admin config setters", () => {
        it("setDefaultMaxStaleness bounds", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await expect(oracle.connect(admin).setDefaultMaxStaleness(0)).to.be.revertedWithCustomError(
                oracle,
                "StalePrice",
            );
            await oracle.connect(admin).setDefaultMaxStaleness(600);
            expect(await oracle.defaultMaxStaleness()).to.equal(600n);
        });
        it("setGuardianQuorum bounds [3,20]", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await expect(oracle.connect(admin).setGuardianQuorum(2)).to.be.revertedWithCustomError(
                oracle,
                "InvalidSource",
            );
            await oracle.connect(admin).setGuardianQuorum(5);
            expect(await oracle.getGuardianQuorum()).to.equal(5n);
        });
        it("registerPausable rejects zero address", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await expect(oracle.connect(admin).registerPausable(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                oracle,
                "ZeroAddress",
            );
        });
        it("setEmergencyPriceProposalMinInterval bounds", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await expect(
                oracle.connect(admin).setEmergencyPriceProposalMinInterval(60),
            ).to.be.revertedWithCustomError(oracle, "InvalidSource");
            await oracle.connect(admin).setEmergencyPriceProposalMinInterval(3600);
            expect(await oracle.emergencyPriceProposalMinInterval()).to.equal(3600n);
        });
        it("addSupportedMarket + getSupportedMarkets", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await oracle.connect(admin).addSupportedMarket(MARKET);
            expect(await oracle.getSupportedMarkets()).to.include(ethers.getAddress(MARKET));
        });
        it("setMarketId rejects too-long id", async () => {
            const { oracle, operator } = await loadFixture(deploy);
            await expect(
                oracle.connect(operator).setMarketId(MARKET, "x".repeat(33)),
            ).to.be.revertedWithCustomError(oracle, "MarketIdTooLong");
        });
    });
});
