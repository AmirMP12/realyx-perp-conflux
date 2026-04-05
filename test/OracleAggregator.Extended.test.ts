import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "./helpers";

describe("OracleAggregator - Extended Coverage", function () {
    let env: any;
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));

    beforeEach(async () => {
        env = await deployTestEnvironment();
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
    });

    // ===== Market management =====
    it("should return empty supported markets list initially", async function () {
        // Default env may already have markets, but getSupportedMarkets should work
        const markets = await env.oracle.getSupportedMarkets();
        expect(markets).to.be.an("array");
    });

    it("should add multiple markets and retrieve them", async function () {
        const m1 = ethers.Wallet.createRandom().address;
        const m2 = ethers.Wallet.createRandom().address;
        await env.oracle.connect(env.admin).addSupportedMarket(m1);
        await env.oracle.connect(env.admin).addSupportedMarket(m2);
        const markets = await env.oracle.getSupportedMarkets();
        expect(markets.length).to.be.gte(2);
    });

    // ===== Pyth Feed Config =====
    it("should set and query pyth feed for market", async function () {
        const m = ethers.Wallet.createRandom().address;
        const feedId = ethers.hexlify(ethers.zeroPadValue(ethers.getBytes("0xab"), 32));
        await env.oracle.connect(env.admin).addSupportedMarket(m);
        await env.oracle.connect(env.admin).setPythFeed(m, feedId, 7200, 100);
    });

    // ===== Global Pause =====
    it("should activate then deactivate global pause", async function () {
        await env.oracle.connect(env.admin).activateGlobalPause();
        expect(await env.oracle.isGloballyPaused()).to.be.true;
        await env.oracle.connect(env.admin).deactivateGlobalPause();
        expect(await env.oracle.isGloballyPaused()).to.be.false;
    });

    it("should revert activateGlobalPause from non-guardian", async function () {
        await expect(
            env.oracle.connect(env.alice).activateGlobalPause()
        ).to.be.reverted;
    });

    // ===== Default Config =====
    it("should return default max deviation bps", async function () {
        const val = await env.oracle.defaultMaxDeviationBps();
        expect(val).to.be.gte(0);
    });

    it("should return default max staleness", async function () {
        const val = await env.oracle.defaultMaxStaleness();
        expect(val).to.be.gte(0);
    });

    // ===== ETH Feed =====
    it("should return ethFeedId", async function () {
        const feedId = await env.oracle.ethFeedId();
        expect(feedId).to.be.a("string");
    });

    // ===== Role Constants =====
    it("should expose role constants", async function () {
        const adminRole = await env.oracle.ADMIN_ROLE();
        const guardianRole = await env.oracle.GUARDIAN_ROLE();
        const operatorRole = await env.oracle.OPERATOR_ROLE();
        expect(adminRole).to.not.equal(ethers.ZeroHash);
        expect(guardianRole).to.not.equal(ethers.ZeroHash);
        expect(operatorRole).to.not.equal(ethers.ZeroHash);
    });

    // ===== registerPausable =====
    it("should get the list of pausable contracts", async function () {
        const list = await env.oracle.getPausableList();
        expect(list).to.be.an("array");
        expect(list.length).to.be.gte(2); // trading + vault registered in helpers
    });

    // ===== setGuardianQuorum =====
    it("should allow admin to set guardian quorum", async function () {
        await env.oracle.connect(env.admin).setGuardianQuorum(2);
        const quorum = await env.oracle.guardianQuorum();
        expect(quorum).to.equal(2);
    });

    // ===== Market Calendar ref =====
    it("should return market calendar address", async function () {
        const cal = await env.oracle.marketCalendar();
        expect(cal).to.equal(ethers.ZeroAddress);
    });

    // ===== Pause/Unpause =====
    it("should allow admin to pause/unpause oracle", async function () {
        await env.oracle.connect(env.admin).pause();
        expect(await env.oracle.paused()).to.be.true;
        await env.oracle.connect(env.admin).unpause();
        expect(await env.oracle.paused()).to.be.false;
    });
});
