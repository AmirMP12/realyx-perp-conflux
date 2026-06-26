import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { setPythPrice, PYTH_EXPO } from "../helpers/pyth";
import { OPERATOR_ROLE, ORACLE_ROLE, GUARDIAN_ROLE, KEEPER_ROLE, BreakerType } from "../helpers/constants";

/**
 * Verifies OracleAggregator guard and bound behaviors:
 *   - `_normalizePythPrice` reverts PriceOutOfBounds on out-of-range exponents
 *   - setMarketCalendar rejects the zero address
 *   - confirmEmergencyPrice and cancelPendingEmergencyPrice are guardian-only
 *   - resetBreaker requires admin or guardian
 *   - confirmEmergencyPause is guardian-only
 *   - setPythFeed enforces staged-rotation parameter matching
 *   - recordPricePoint wraps the TWAP ring buffer correctly
 *   - registerPausable enforces the MAX_PAUSABLES cap
 */

const FEED = ethers.zeroPadValue("0x0abc", 32);
const FEED_B = ethers.zeroPadValue("0x0bcd", 32);
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

async function pushRaw(pyth: any, feedId: string, rawPrice: bigint, rawConf: bigint, expo: number) {
    const block = await ethers.provider.getBlock("latest");
    const t = block!.timestamp;
    const data = await pyth.createPriceFeedUpdateData(feedId, rawPrice, rawConf, expo, rawPrice, rawConf, t, 0);
    const fee = await pyth.getUpdateFee([data]);
    await pyth.updatePriceFeeds([data], { value: fee });
}

describe("OracleAggregator", () => {
    it("reverts PriceOutOfBounds when the Pyth exponent normalizes out of range", async () => {
        const { oracle, operator, pyth } = await loadFixture(deploy);
        await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
        // expo = 13 -> decimalDiff = 18 + 13 = 31 > 30 -> PriceOutOfBounds
        await pushRaw(pyth, FEED, 5n, 0n, 13);
        await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "PriceOutOfBounds");
    });

    it("reverts PriceOutOfBounds for a deeply-negative exponent", async () => {
        const { oracle, operator, pyth } = await loadFixture(deploy);
        await oracle.connect(operator).setPythFeed(MARKET, FEED, 900, 10n ** 15n);
        // expo = -49 -> decimalDiff = -31 < -30 -> PriceOutOfBounds
        await pushRaw(pyth, FEED, 5n, 0n, -49);
        await expect(oracle.getPrice(MARKET)).to.be.revertedWithCustomError(oracle, "PriceOutOfBounds");
    });

    it("setMarketCalendar rejects the zero address", async () => {
        const { oracle, admin } = await loadFixture(deploy);
        await expect(oracle.connect(admin).setMarketCalendar(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            oracle,
            "ZeroAddress",
        );
    });

    it("confirmEmergencyPrice rejects a non-guardian", async () => {
        const { oracle, other } = await loadFixture(deployWithFeed);
        const fakeId = ethers.zeroPadValue("0x01", 32);
        await expect(oracle.connect(other).confirmEmergencyPrice(fakeId)).to.be.reverted;
    });

    it("cancelPendingEmergencyPrice rejects a non-guardian", async () => {
        const { oracle, other } = await loadFixture(deployWithFeed);
        await expect(oracle.connect(other).cancelPendingEmergencyPrice(MARKET)).to.be.reverted;
    });

    it("resetBreaker rejects a caller that is neither admin nor guardian", async () => {
        const { oracle, operator, other } = await loadFixture(deployWithFeed);
        await oracle.connect(operator).configureBreaker(MARKET, BreakerType.PRICE_DROP, 1000, 900, 600);
        await expect(oracle.connect(other).resetBreaker(MARKET, BreakerType.PRICE_DROP)).to.be.reverted;
    });

    it("confirmEmergencyPause rejects a non-guardian", async () => {
        const { oracle, other } = await loadFixture(deploy);
        const fakeId = ethers.zeroPadValue("0x02", 32);
        await expect(oracle.connect(other).confirmEmergencyPause(fakeId)).to.be.reverted;
    });

    it("setPythFeed reverts PendingFeedMismatch when a staged rotation has a different staleness", async () => {
        const { oracle, operator } = await loadFixture(deployWithFeed);
        // stage a rotation to FEED_B with staleness 900
        await oracle.connect(operator).proposePythFeed(MARKET, FEED_B, 900, 10n ** 15n);
        // applying with a DIFFERENT staleness (1800) does not match the staged rotation
        await expect(
            oracle.connect(operator).setPythFeed(MARKET, FEED_B, 1800, 10n ** 15n),
        ).to.be.revertedWithCustomError(oracle, "PendingFeedMismatch");
    });

    it("setPythFeed reverts PendingFeedMismatch when a staged rotation has a different confidence", async () => {
        const { oracle, operator } = await loadFixture(deployWithFeed);
        await oracle.connect(operator).proposePythFeed(MARKET, FEED_B, 900, 10n ** 15n);
        await expect(
            oracle.connect(operator).setPythFeed(MARKET, FEED_B, 900, 10n ** 14n),
        ).to.be.revertedWithCustomError(oracle, "PendingFeedMismatch");
    });

    it("recordPricePoint wraps the TWAP ring buffer", async () => {
        const { oracle, oracleBot, pyth } = await loadFixture(deployWithFeed);
        // 49 samples > TWAP_BUFFER_SIZE (48) so head wraps back to 0 and count saturates.
        for (let i = 0; i < 49; i++) {
            await setPythPrice(pyth, FEED, e18(50_000));
            await oracle.connect(oracleBot).recordPricePoint(MARKET, 0);
            await time.increase(35); // exceed MIN_TWAP_UPDATE_INTERVAL (30s)
        }
        const [twap, valid] = await oracle.getTWAPWithValidation(MARKET, 900, 6);
        expect(twap).to.be.greaterThan(0n);
        expect(valid).to.equal(true);
    });

    it("registerPausable enforces the MAX_PAUSABLES cap", async () => {
        const { oracle, admin } = await loadFixture(deploy);
        // Register exactly MAX_PAUSABLES (50) distinct targets, then the 51st must revert.
        for (let i = 1; i <= 50; i++) {
            const addr = ethers.getAddress("0x" + i.toString(16).padStart(40, "0"));
            await oracle.connect(admin).registerPausable(addr);
        }
        const overflow = ethers.getAddress("0x" + (51).toString(16).padStart(40, "0"));
        await expect(oracle.connect(admin).registerPausable(overflow)).to.be.revertedWithCustomError(
            oracle,
            "TooManyPausables",
        );
    });
});
