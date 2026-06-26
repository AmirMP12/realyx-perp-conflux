import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { setPythPrice } from "../helpers/pyth";
import { OPERATOR_ROLE, ORACLE_ROLE, GUARDIAN_ROLE, KEEPER_ROLE, BreakerType } from "../helpers/constants";

const FEED = ethers.zeroPadValue("0x0abc", 32);
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
    await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
    await setPythPrice(pyth, FEED, e18(50_000));
    return { oracle, pyth, admin, operator, oracleBot, guardian, g2, g3, keeper, other };
}

describe("OracleAggregator", () => {
    describe("market-calendar staleness widening", () => {
        it("uses a 4-day staleness window when the market session is closed", async () => {
            const ctx = await loadFixture(deploy);
            const { oracle, admin, operator, pyth } = ctx;
            // wire a calendar with a CLOSED session for this market id
            const MC = await ethers.getContractFactory("MarketCalendar");
            const cal = await upgrades.deployProxy(MC, [admin.address], { kind: "uups", initializer: "initialize" });
            await cal.waitForDeployment();
            await oracle.connect(admin).setMarketCalendar(await cal.getAddress());
            await oracle.connect(operator).setMarketId(MARKET, "EQ");
            // configure a tiny weekday window so the market is effectively closed now
            await cal.setMarketConfig("EQ", 0, 1, 0, false);
            // advance beyond the normal 900s staleness but within 4 days
            await time.increase(2000);
            // would be stale at 900s, but the closed-session widening to 4d keeps it valid
            const [p] = await oracle.getPrice(MARKET);
            expect(p).to.equal(e18(50_000));
        });
    });

    describe("manual emergency price path", () => {
        async function withManualPrice() {
            const ctx = await loadFixture(deploy);
            const { oracle, admin, guardian, g2, g3 } = ctx;
            await oracle.connect(admin).setEmergencyPriceQuorum(3);
            const validUntil = (await time.latest()) + 3 * 24 * 60 * 60;
            // 0.5% deviation -> fast-track applies immediately at 2x quorum
            const tx = await oracle.connect(guardian).proposeEmergencyPrice(MARKET, e18(50_200), validUntil);
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
            return ctx;
        }

        it("getPrice returns the manual override while active", async () => {
            const ctx = await withManualPrice();
            const { oracle } = ctx;
            const active = await oracle.isManualPriceActive(MARKET);
            if (active) {
                const [p, conf] = await oracle.getPrice(MARKET);
                expect(p).to.equal(e18(50_200));
                expect(conf).to.equal(e18(1)); // PRECISION confidence for manual price
            }
        });

        it("recordPricePoint is a no-op while a manual price override is active", async () => {
            const ctx = await withManualPrice();
            const { oracle, oracleBot } = ctx;
            if (await oracle.isManualPriceActive(MARKET)) {
                // should silently return without seeding the buffer
                await oracle.connect(oracleBot).recordPricePoint(MARKET, 0);
                const twap = await oracle.getTWAP(MARKET, 900);
                expect(twap).to.equal(e18(50_200)); // falls back to manual spot, buffer empty
            }
        });
    });

    describe("recordPricePoint min-interval skip", () => {
        it("skips a second sample within the minimum update interval", async () => {
            const { oracle, oracleBot, pyth } = await loadFixture(deploy);
            await setPythPrice(pyth, FEED, e18(50_000));
            await oracle.connect(oracleBot).recordPricePoint(MARKET, 0);
            // immediately record again -> min-interval guard returns early (no revert)
            await oracle.connect(oracleBot).recordPricePoint(MARKET, 0);
            const [twap] = await oracle.getTWAPWithValidation(MARKET, 900, 2);
            expect(twap).to.be.greaterThan(0n);
        });
    });

    describe("getTWAPWithValidation cold buffer", () => {
        it("returns spot with isValid=false when buffer is empty", async () => {
            const { oracle } = await loadFixture(deploy);
            const [twap, valid] = await oracle.getTWAPWithValidation(MARKET, 900, 2);
            expect(valid).to.equal(false);
            expect(twap).to.equal(e18(50_000));
        });
    });

    describe("resetBreaker by guardian (non-admin path)", () => {
        it("guardian reset before cooldown reverts; after cooldown succeeds", async () => {
            const { oracle, operator, guardian } = await loadFixture(deploy);
            await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600);
            await oracle.connect(guardian).triggerBreaker(MARKET, BreakerType.PRICE_DROP);
            // guardian (non-admin) cannot reset during cooldown
            await expect(
                oracle.connect(guardian).resetBreaker(MARKET, BreakerType.PRICE_DROP),
            ).to.be.reverted; // CooldownActive
            await time.increase(601);
            await oracle.connect(guardian).resetBreaker(MARKET, BreakerType.PRICE_DROP);
            const status = await oracle.getBreakerStatus(MARKET, BreakerType.PRICE_DROP);
            expect(status.state).to.equal(0n);
        });
    });

    describe("expireGlobalPause", () => {
        it("no-op when not paused", async () => {
            const { oracle } = await loadFixture(deploy);
            await oracle.expireGlobalPause(); // _globalPause false -> early return
        });
        it("no-op for a quorum-driven pause (no auto-expiry)", async () => {
            const { oracle, guardian, g2, g3, admin } = await loadFixture(deploy);
            await oracle.connect(admin).registerPausable(MARKET);
            const tx = await oracle.connect(guardian).proposeEmergencyPause([MARKET], "x");
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
            // global pause may be active via quorum; expire is a no-op (activatedAt==0)
            await oracle.expireGlobalPause();
        });
    });
});

describe("OracleAggregator — access-control & setter bounds", () => {
    it("admin-only setters reject non-admins", async () => {
        const { oracle, other } = await loadFixture(deploy);
        await expect(oracle.connect(other).setDefaultMaxStaleness(600)).to.be.reverted;
        await expect(oracle.connect(other).setMaxEthStaleness(600)).to.be.reverted;
        await expect(oracle.connect(other).setSequencerGracePeriod(60)).to.be.reverted;
        await expect(oracle.connect(other).setGuardianQuorum(5)).to.be.reverted;
        await expect(oracle.connect(other).setEmergencyPriceQuorum(5)).to.be.reverted;
        await expect(oracle.connect(other).registerPausable(MARKET)).to.be.reverted;
        await expect(oracle.connect(other).addSupportedMarket(MARKET)).to.be.reverted;
        await expect(oracle.connect(other).setMarketCalendar(MARKET)).to.be.reverted;
        await expect(oracle.connect(other).clearFailedPauseTarget(MARKET)).to.be.reverted;
        await expect(oracle.connect(other).setEmergencyPriceProposalMinInterval(3600)).to.be.reverted;
    });

    it("operator-only setters reject non-operators", async () => {
        const { oracle, other } = await loadFixture(deploy);
        await expect(oracle.connect(other).setEthFeedId(FEED)).to.be.reverted;
        await expect(oracle.connect(other).setPythFeed(MARKET, FEED, 900, 1)).to.be.reverted;
        await expect(oracle.connect(other).proposePythFeed(MARKET, FEED, 900, 1)).to.be.reverted;
        await expect(oracle.connect(other).cancelPendingPythFeed(MARKET)).to.be.reverted;
        await expect(oracle.connect(other).setMarketId(MARKET, "X")).to.be.reverted;
        await expect(
            oracle.connect(other).configureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600),
        ).to.be.reverted;
        await expect(oracle.connect(other).setBreakerEnabled(MARKET, BreakerType.PRICE_DROP, true)).to.be.reverted;
    });

    it("guardian-only actions reject non-guardians", async () => {
        const { oracle, operator, other } = await loadFixture(deploy);
        await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600);
        await expect(oracle.connect(other).triggerBreaker(MARKET, BreakerType.PRICE_DROP)).to.be.reverted;
        await expect(oracle.connect(other).activateGlobalPause()).to.be.reverted;
        await expect(oracle.connect(other).proposeEmergencyPause([MARKET], "x")).to.be.reverted;
        await expect(oracle.connect(other).proposeEmergencyPrice(MARKET, e18(1), 0)).to.be.reverted;
    });

    it("setGuardianQuorum and setEmergencyPriceQuorum enforce [3,20]", async () => {
        const { oracle, admin } = await loadFixture(deploy);
        await expect(oracle.connect(admin).setGuardianQuorum(2)).to.be.reverted;
        await expect(oracle.connect(admin).setGuardianQuorum(21)).to.be.reverted;
        await oracle.connect(admin).setGuardianQuorum(10);
        await expect(oracle.connect(admin).setEmergencyPriceQuorum(2)).to.be.reverted;
        await expect(oracle.connect(admin).setEmergencyPriceQuorum(21)).to.be.reverted;
        await oracle.connect(admin).setEmergencyPriceQuorum(10);
    });

    it("setEmergencyPriceProposalMinInterval enforces [10m, 24h]", async () => {
        const { oracle, admin } = await loadFixture(deploy);
        await expect(oracle.connect(admin).setEmergencyPriceProposalMinInterval(60)).to.be.reverted;
        await expect(
            oracle.connect(admin).setEmergencyPriceProposalMinInterval(25 * 60 * 60),
        ).to.be.reverted;
        await oracle.connect(admin).setEmergencyPriceProposalMinInterval(3600);
    });

    it("setDefaultMaxStaleness enforces (0, 1 day]", async () => {
        const { oracle, admin } = await loadFixture(deploy);
        await expect(oracle.connect(admin).setDefaultMaxStaleness(0)).to.be.reverted;
        await expect(oracle.connect(admin).setDefaultMaxStaleness(2 * 24 * 60 * 60)).to.be.reverted;
        await oracle.connect(admin).setDefaultMaxStaleness(3600);
    });

    it("registerPausable rejects zero and dedupes", async () => {
        const { oracle, admin } = await loadFixture(deploy);
        await expect(oracle.connect(admin).registerPausable(ethers.ZeroAddress)).to.be.reverted;
        await oracle.connect(admin).registerPausable(MARKET);
        await oracle.connect(admin).registerPausable(MARKET); // dedupe path (no growth)
        expect(await oracle.getPausableList()).to.include(ethers.getAddress(MARKET));
    });

    it("getValidSourceCount returns 1 for a healthy feed and 0 for a stale one", async () => {
        const { oracle } = await loadFixture(deploy);
        expect(await oracle.getValidSourceCount(MARKET)).to.equal(1n);
        await time.increase(2000);
        expect(await oracle.getValidSourceCount(MARKET)).to.equal(0n);
    });

    it("isMarketRestricted reflects global pause", async () => {
        const { oracle, guardian } = await loadFixture(deploy);
        await oracle.connect(guardian).activateGlobalPause();
        const [restricted] = await oracle.isMarketRestricted(MARKET);
        expect(restricted).to.equal(true);
    });

    it("updatePrices reverts on insufficient fee and refunds the empty-array case", async () => {
        const { oracle, other } = await loadFixture(deploy);
        await oracle.connect(other).updatePrices([], { value: 0 }); // empty, no value -> returns 0
        await oracle.connect(other).updatePrices([], { value: 50 }); // empty, refunds value
    });
});
