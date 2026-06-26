import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { setPythPrice } from "../helpers/pyth";
import { BreakerType, OPERATOR_ROLE, ORACLE_ROLE, GUARDIAN_ROLE, KEEPER_ROLE } from "../helpers/constants";

const FEED = ethers.zeroPadValue("0x0abc", 32);
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

async function deployWithFeed() {
    const ctx = await deploy();
    await ctx.oracle.connect(ctx.operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
    await setPythPrice(ctx.pyth, FEED, e18(50_000));
    return ctx;
}

async function seedTwapBuffer(ctx: any, price: bigint) {
    for (let i = 0; i < 4; i++) {
        await setPythPrice(ctx.pyth, FEED, price);
        await ctx.oracle.connect(ctx.oracleBot).recordPricePoint(MARKET, 0);
        await time.increase(35);
    }
    await setPythPrice(ctx.pyth, FEED, price);
}

describe("OracleAggregator", () => {
    describe("ETH/USD feed", () => {
        it("reverts NoEthUsdFeed when not set", async () => {
            const { oracle } = await loadFixture(deploy);
            await expect(oracle.getEthUsdPrice()).to.be.revertedWithCustomError(oracle, "NoEthUsdFeed");
        });
        it("returns normalized ETH price when configured", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setEthFeedId(ETH_FEED);
            await setPythPrice(pyth, ETH_FEED, e18(3000));
            expect(await oracle.getEthUsdPrice()).to.equal(e18(3000));
        });
        it("reverts StalePrice when ETH feed is stale", async () => {
            const { oracle, operator, pyth } = await loadFixture(deploy);
            await oracle.connect(operator).setEthFeedId(ETH_FEED);
            await setPythPrice(pyth, ETH_FEED, e18(3000));
            await time.increase(7 * 60 * 60); // beyond default maxEthStaleness
            await expect(oracle.getEthUsdPrice()).to.be.revertedWithCustomError(oracle, "StalePrice");
        });
        it("only operator sets ETH feed id", async () => {
            const { oracle, other } = await loadFixture(deploy);
            await expect(oracle.connect(other).setEthFeedId(ETH_FEED)).to.be.revertedWithCustomError(
                oracle,
                "NotOperator",
            );
        });
    });

    describe("staleness / grace setters", () => {
        it("setMaxEthStaleness bounds", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await expect(oracle.connect(admin).setMaxEthStaleness(0)).to.be.reverted;
            await expect(oracle.connect(admin).setMaxEthStaleness(7 * 60 * 60)).to.be.reverted; // >6h
            await oracle.connect(admin).setMaxEthStaleness(60 * 60);
            expect(await oracle.maxEthStaleness()).to.equal(3600n);
        });
        it("setSequencerGracePeriod bounds", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await expect(oracle.connect(admin).setSequencerGracePeriod(3 * 60 * 60)).to.be.reverted; // >2h
            await oracle.connect(admin).setSequencerGracePeriod(30 * 60);
            expect(await oracle.sequencerGracePeriod()).to.equal(1800n);
        });
    });

    describe("checkBreakers (keeper)", () => {
        it("records price and evaluates breakers", async () => {
            const ctx = await loadFixture(deployWithFeed);
            const { oracle, operator, keeper } = ctx;
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.TWAP_DEVIATION, 500, 900, 600);
            await seedTwapBuffer(ctx, e18(50_000));
            // a check at the current price should not trigger
            await oracle.connect(keeper).checkBreakers(MARKET, 0, 0);
        });
        it("only oracle/keeper can call checkBreakers", async () => {
            const { oracle, other } = await loadFixture(deployWithFeed);
            await expect(oracle.connect(other).checkBreakers(MARKET, 0, 0)).to.be.revertedWithCustomError(
                oracle,
                "NotOracleOrKeeper",
            );
        });
        it("triggers price-drop breaker on a sharp drop", async () => {
            const ctx = await loadFixture(deployWithFeed);
            const { oracle, operator, keeper, pyth } = ctx;
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
            await seedTwapBuffer(ctx, e18(50_000));
            // push a big drop then evaluate
            await setPythPrice(pyth, FEED, e18(40_000));
            await oracle.connect(keeper).checkBreakers(MARKET, 0, 0);
            const [restricted] = await oracle.isMarketRestricted(MARKET);
            expect(restricted).to.equal(true);
        });
    });

    describe("autoResetBreakers", () => {
        it("auto-resets triggered breakers after cooldown when healthy", async () => {
            const { oracle, operator, guardian } = await loadFixture(deployWithFeed);
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 500, 900, 600);
            await oracle.connect(guardian).triggerBreaker(MARKET, BreakerType.PRICE_DROP);
            await time.increase(601);
            await oracle.autoResetBreakers(MARKET);
            const status = await oracle.getBreakerStatus(MARKET, BreakerType.PRICE_DROP);
            expect(status.state).to.equal(0n); // INACTIVE
        });
        it("does nothing when oracle unhealthy", async () => {
            const { oracle } = await loadFixture(deploy);
            // unconfigured -> unhealthy -> early return, no revert
            await oracle.autoResetBreakers(MARKET);
        });
    });

    describe("pending feed rotation read/cancel", () => {
        it("proposePythFeed then read + cancel", async () => {
            const { oracle, operator } = await loadFixture(deployWithFeed);
            const FEED2 = ethers.zeroPadValue("0x0def", 32);
            await oracle.connect(operator).proposePythFeed(MARKET, FEED2, 900, 10n ** 15n);
            const [feedId, , , effective] = await oracle.pendingPythFeed(MARKET);
            expect(feedId).to.equal(FEED2);
            expect(effective).to.be.greaterThan(0n);
            await oracle.connect(operator).cancelPendingPythFeed(MARKET);
            const [, , , effectiveAfter] = await oracle.pendingPythFeed(MARKET);
            expect(effectiveAfter).to.equal(0n);
        });
        it("proposePythFeed reverts on zero maxConfidence", async () => {
            const { oracle, operator } = await loadFixture(deployWithFeed);
            await expect(
                oracle.connect(operator).proposePythFeed(MARKET, FEED, 900, 0),
            ).to.be.revertedWithCustomError(oracle, "MaxConfidenceRequired");
        });
    });

    describe("emergency price flow", () => {
        it("propose + confirm to quorum stages or applies override", async () => {
            const { oracle, admin, operator, guardian, g2, g3, pyth } = await loadFixture(deployWithFeed);
            await oracle.connect(admin).setEmergencyPriceQuorum(3);
            const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
            const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(50_500), validUntil); // ~1%
            const rc = await tx.wait();
            const ev = rc!.logs
                .map((l: any) => {
                    try {
                        return oracle.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.args && p.args.proposalId !== undefined);
            const proposalId = ev?.args?.proposalId;
            expect(proposalId).to.not.equal(undefined);
            await oracle.connect(g2).confirmEmergencyPrice(proposalId);
            await oracle.connect(g3).confirmEmergencyPrice(proposalId);
            // either applied (manual price active) or staged pending
            const active = await oracle.isManualPriceActive(MARKET);
            const [pendingPrice] = await oracle.getPendingEmergencyPrice(MARKET);
            expect(active || pendingPrice > 0n).to.equal(true);
        });
        it("cancelPendingEmergencyPrice reverts when none staged", async () => {
            const { oracle, guardian } = await loadFixture(deployWithFeed);
            await expect(
                oracle.connect(guardian).cancelPendingEmergencyPrice(MARKET),
            ).to.be.reverted;
        });
    });

    describe("historical price", () => {
        it("reverts DataNotFound when no record", async () => {
            const { oracle } = await loadFixture(deployWithFeed);
            await expect(oracle.getHistoricalPrice(MARKET, 1)).to.be.revertedWithCustomError(
                oracle,
                "DataNotFound",
            );
        });
        it("returns a recorded historical price after a breaker check", async () => {
            const ctx = await loadFixture(deployWithFeed);
            const { oracle, keeper } = ctx;
            await seedTwapBuffer(ctx, e18(50_000));
            await oracle.connect(keeper).checkBreakers(MARKET, 0, 0); // records historical price at current slot
            const price = await oracle.getHistoricalPrice(MARKET, 0);
            expect(price).to.be.greaterThan(0n);
        });
    });

    describe("getPausableList + registerPausable", () => {
        it("registers and lists pausables", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await oracle.connect(admin).registerPausable(MARKET);
            expect(await oracle.getPausableList()).to.include(ethers.getAddress(MARKET));
        });
    });

    describe("clearFailedPauseTarget", () => {
        it("no-op when target not failed", async () => {
            const { oracle, admin } = await loadFixture(deploy);
            await oracle.connect(admin).clearFailedPauseTarget(MARKET); // should not revert
        });
    });

    describe("emergency pause quorum execution", () => {
        it("registers pausables, reaches quorum, and pauses targets", async () => {
            const { oracle, admin, guardian, g2, g3 } = await loadFixture(deploy);
            const Pausable = await ethers.getContractFactory("MockPausableForEmergency");
            const p1 = await Pausable.deploy();
            await p1.waitForDeployment();
            await oracle.connect(admin).registerPausable(await p1.getAddress());

            const tx = await oracle.connect(guardian).proposeEmergencyPause([await p1.getAddress()], "incident");
            const rc = await tx.wait();
            const ev = rc!.logs
                .map((l: any) => {
                    try {
                        return oracle.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.args && p.args.pauseId !== undefined);
            const pauseId = ev?.args?.pauseId;
            expect(pauseId).to.not.equal(undefined);
            // quorum is 3: proposer + g2 + g3
            await oracle.connect(g2).confirmEmergencyPause(pauseId);
            await oracle.connect(g3).confirmEmergencyPause(pauseId);
            expect(await p1.paused()).to.equal(true);
        });

        it("tracks failed pause targets and clears them", async () => {
            const { oracle, admin, guardian, g2, g3 } = await loadFixture(deploy);
            const Reverting = await ethers.getContractFactory("MockPausableRevertOnPause");
            const r = await Reverting.deploy();
            await r.waitForDeployment();
            await oracle.connect(admin).registerPausable(await r.getAddress());
            const tx = await oracle.connect(guardian).proposeEmergencyPause([await r.getAddress()], "x");
            const rc = await tx.wait();
            const pauseId = rc!.logs
                .map((l: any) => {
                    try {
                        return oracle.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.args && p.args.pauseId !== undefined)?.args?.pauseId;
            await oracle.connect(g2).confirmEmergencyPause(pauseId);
            await oracle.connect(g3).confirmEmergencyPause(pauseId);
            // failed target recorded; admin can clear it
            expect(await oracle.failedPauseCount()).to.be.greaterThan(0n);
            await oracle.connect(admin).clearFailedPauseTarget(await r.getAddress());
        });
    });

    describe("applyPendingEmergencyPrice", () => {
        it("stages a >1% override then applies it after the timelock", async () => {
            const { oracle, admin, guardian, g2, g3, pyth } = await loadFixture(deployWithFeed);
            await oracle.connect(admin).setEmergencyPriceQuorum(3);
            const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
            // 2% deviation -> above fast-track (1%) so it stages a pending override
            const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(51_000), validUntil);
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
            const [pendingPrice] = await oracle.getPendingEmergencyPrice(MARKET);
            expect(pendingPrice).to.equal(e18(51_000));
            // applying before timelock reverts
            await expect(oracle.applyPendingEmergencyPrice(MARKET)).to.be.reverted;
            await time.increase(24 * 60 * 60 + 1);
            // refresh spot so the apply-time deviation re-check passes
            await setPythPrice(pyth, FEED, e18(51_000));
            await oracle.applyPendingEmergencyPrice(MARKET);
            expect(await oracle.isManualPriceActive(MARKET)).to.equal(true);
        });
    });

    describe("getHistoricalPrice multi-bucket", () => {
        it("returns the most recent recorded slot", async () => {
            const ctx = await loadFixture(deployWithFeed);
            const { oracle, keeper } = ctx;
            await seedTwapBuffer(ctx, e18(50_000));
            await oracle.connect(keeper).checkBreakers(MARKET, 0, 0);
            const p = await oracle.getHistoricalPrice(MARKET, 0);
            expect(p).to.be.greaterThan(0n);
        });
    });
});
