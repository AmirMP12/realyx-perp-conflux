import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Branch coverage wave 2 (oracle / emergency / TWAP / pause quorum)", function () {
    async function fixture() {
        return { env: await deployTestEnvironment() };
    }

    async function pushPrice(
        env: Awaited<ReturnType<typeof deployTestEnvironment>>,
        feedId: string,
        price: bigint,
        conf: bigint = 1n,
        publishTime?: number
    ) {
        const now = publishTime ?? Number(await time.latest());
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId,
            price,
            conf,
            -8,
            price,
            conf,
            BigInt(now),
            BigInt(now)
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    async function setupMarket(env: Awaited<ReturnType<typeof deployTestEnvironment>>, tag: string) {
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes(`WAVE2-${tag}-${Date.now()}`));
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            100,
            ethers.parseUnits("500000", 6),
            ethers.parseUnits("10000000", 6),
            5000,
            10000,
            3600
        );
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        return { market, feedId };
    }

    it("EmergencyPriceLib: executes with no oracle ref when quorum allows (lines 129–136)", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);

        await env.oracle.connect(env.admin).setEmergencyPriceQuorum(1n);

        const ghostCollection = ethers.Wallet.createRandom().address;
        const validUntil = BigInt((await time.latest()) + 3600);
        const tx = await env.oracle.connect(env.alice).proposeEmergencyPrice(ghostCollection, ethers.parseEther("100"), validUntil);
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), receipt!.blockNumber);
        const proposalId = (evs[evs.length - 1] as any).args.proposalId;

        await env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId);
        const pr = await env.oracle.getPrice(ghostCollection);
        expect(pr[0]).to.equal(ethers.parseEther("100"));

        await env.oracle.connect(env.admin).setEmergencyPriceQuorum(2n);
    });

    it("EmergencyPriceLib: execute when proposal price is below live ref (delta ternary branch)", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        const { market, feedId } = await setupMarket(env, "em-below-ref");
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        const ref = (await env.oracle.getPrice(market))[0];
        const lower = (ref * 95n) / 100n;
        const validUntil = BigInt((await time.latest()) + 3600);
        const tx = await env.oracle.connect(env.alice).proposeEmergencyPrice(market, lower, validUntil);
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), receipt!.blockNumber);
        const proposalId = (evs[evs.length - 1] as any).args.proposalId;
        await env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId);
        const p = await env.oracle.getPrice(market);
        expect(p[0]).to.equal(lower);
    });

    it("EmergencyPriceLib: no-ref path reverts when price exceeds absolute cap (line 134)", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.connect(env.admin).setEmergencyPriceQuorum(1n);

        const ghostCollection = ethers.Wallet.createRandom().address;
        const validUntil = BigInt((await time.latest()) + 3600);
        const huge = 2n * 10n ** 24n;
        const tx = await env.oracle.connect(env.alice).proposeEmergencyPrice(ghostCollection, huge, validUntil);
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), receipt!.blockNumber);
        const proposalId = (evs[evs.length - 1] as any).args.proposalId;

        await expect(env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId)).to.be.revertedWithCustomError(
            env.oracle,
            "EmergencyPriceDeviationTooHigh"
        );
        await env.oracle.connect(env.admin).setEmergencyPriceQuorum(2n);
    });

    it("OracleAggregator: _getPriceView extends staleness when calendar reports market closed (line 190)", async function () {
        const { env } = await loadFixture(fixture);
        await env.oracle.connect(env.admin).setMarketCalendar(await env.marketCalendar.getAddress());

        const { market, feedId } = await setupMarket(env, "cal-stale");
        await env.oracle.connect(env.admin).setMarketId(market, "ORACLE-CLOSE");

        await env.marketCalendar.connect(env.admin).setMarketConfig("ORACLE-CLOSE", 600, 660, 0, false);
        for (let d = 0; d < 7; d++) {
            await env.marketCalendar.connect(env.admin).setTradingDay("ORACLE-CLOSE", d, false);
        }

        const now = Number(await time.latest());
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n, now - 3600);

        const p = await env.oracle.getPrice(market);
        expect(p[0]).to.be.gt(0n);
    });

    it("OracleAggregator: _getPriceView catch converts pyth failure to DataNotFound (line 212)", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const badFeed = ethers.keccak256(ethers.toUtf8Bytes("never-seeded-feed"));
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            100,
            ethers.parseUnits("500000", 6),
            ethers.parseUnits("10000000", 6),
            5000,
            10000,
            3600
        );
        await env.oracle.connect(env.admin).setPythFeed(market, badFeed, 3600, 0);
        await expect(env.oracle.getPrice(market)).to.be.revertedWithCustomError(env.oracle, "DataNotFound");
    });

    it("EmergencyPriceLib: confirm may not execute until quorum (outer confirmations gate)", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.connect(env.admin).setEmergencyPriceQuorum(5n);

        const { market, feedId } = await setupMarket(env, "em-quorum-gate");
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        const ref = (await env.oracle.getPrice(market))[0];
        const validUntil = BigInt((await time.latest()) + 3600);
        const tx = await env.oracle.connect(env.alice).proposeEmergencyPrice(market, ref, validUntil);
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), receipt!.blockNumber);
        const proposalId = (evs[evs.length - 1] as any).args.proposalId;
        await env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId);
        const p = await env.oracle.getPrice(market);
        expect(p[0]).to.equal(ref);

        await env.oracle.connect(env.admin).setEmergencyPriceQuorum(2n);
    });

    it("OracleAggregator: getPriceWithConfidence enforces max uncertainty", async function () {
        const { env } = await loadFixture(fixture);
        const { market } = await setupMarket(env, "conf-max");
        await expect(env.oracle.getPriceWithConfidence(market, 0n)).to.be.revertedWithCustomError(
            env.oracle,
            "InsufficientConfidence"
        );
        await expect(env.oracle.getPriceWithConfidence(market, ethers.MaxUint256)).to.not.be.reverted;
    });

    it("EmergencyPauseLib: execute with only non-pausable targets is a no-op", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);

        const ghost = ethers.Wallet.createRandom().address;
        const tx = await env.oracle.connect(env.alice).proposeEmergencyPause([ghost], "noop");
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPauseProposed(), receipt!.blockNumber);
        const pauseId = (evs[evs.length - 1] as any).args.pauseId as string;
        await env.oracle.connect(env.bob).confirmEmergencyPause(pauseId);
    });

    it("OracleAggregator: getTWAPWithValidation buffer path (isValid true/false)", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "twap-val");
        const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
        await env.oracle.grantRole(KEEPER_ROLE, env.keeper.address);

        for (let i = 0; i < 8; i++) {
            await pushPrice(env, feedId, (BigInt(100 + i) * 10n ** 8n) as bigint, 1n);
            await env.oracle.connect(env.keeper).recordPricePoint(market, 0);
            if (i < 7) await time.increase(400);
        }

        const [twap, ok1] = await env.oracle.getTWAPWithValidation(market, 86400, 2);
        expect(twap).to.be.gt(0n);
        expect(ok1).to.equal(true);

        const [, ok2] = await env.oracle.getTWAPWithValidation(market, 86400, 1000);
        expect(ok2).to.equal(false);
    });

    it("OracleAggregator: getEthUsdPrice stale, invalid, and feed-missing branches", async function () {
        const { env } = await loadFixture(fixture);
        const ethFeedId = ethers.keccak256(ethers.toUtf8Bytes("ETH-USD-WAVE2"));
        await env.oracle.connect(env.admin).setEthFeedId(ethFeedId);

        const staleTime = Number(await time.latest()) - 7200;
        await pushPrice(env, ethFeedId, 2000n * 10n ** 8n, 1n, staleTime);
        await expect(env.oracle.getEthUsdPrice()).to.be.revertedWithCustomError(env.oracle, "StalePrice");

        const freshTime = Number(await time.latest());
        await pushPrice(env, ethFeedId, 0n, 1n, freshTime);
        await expect(env.oracle.getEthUsdPrice()).to.be.revertedWithCustomError(env.oracle, "InvalidSource");

        const missingFeed = ethers.keccak256(ethers.toUtf8Bytes("ETH-MISSING"));
        await env.oracle.connect(env.admin).setEthFeedId(missingFeed);
        await expect(env.oracle.getEthUsdPrice()).to.be.revertedWithCustomError(env.oracle, "DataNotFound");
    });

    it("EmergencyPauseLib: sub-quorum confirm skips execute; non-pausable targets are skipped", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.keeper.address);

        const MockPausableSuccess = await ethers.getContractFactory("MockPausableSuccess");
        const mockTarget = await MockPausableSuccess.deploy();
        await mockTarget.waitForDeployment();
        await env.oracle.connect(env.admin).registerPausable(await mockTarget.getAddress());

        await env.oracle.connect(env.admin).setGuardianQuorum(3n);

        const random = ethers.Wallet.createRandom().address;
        const tx = await env.oracle
            .connect(env.alice)
            .proposeEmergencyPause([random, await mockTarget.getAddress()], "wave2");
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPauseProposed(), receipt!.blockNumber);
        const pauseId = (evs[evs.length - 1] as any).args.pauseId as string;

        expect(await mockTarget.paused()).to.equal(false);

        await env.oracle.connect(env.bob).confirmEmergencyPause(pauseId);
        expect(await mockTarget.paused()).to.equal(false);

        await env.oracle.connect(env.keeper).confirmEmergencyPause(pauseId);
        expect(await mockTarget.paused()).to.equal(true);

        await env.oracle.connect(env.admin).setGuardianQuorum(2n);
    });

    it("EmergencyPauseLib: mixed pause() success and failure in one proposal", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);

        const MockPausableSuccess = await ethers.getContractFactory("MockPausableSuccess");
        const okTarget = await MockPausableSuccess.deploy();
        await okTarget.waitForDeployment();
        const RevertPause = await ethers.getContractFactory("MockRevertOnPause");
        const badTarget = await RevertPause.deploy();
        await badTarget.waitForDeployment();

        await env.oracle.connect(env.admin).registerPausable(await okTarget.getAddress());
        await env.oracle.connect(env.admin).registerPausable(await badTarget.getAddress());

        const tx = await env.oracle
            .connect(env.alice)
            .proposeEmergencyPause([await badTarget.getAddress(), await okTarget.getAddress()], "mix");
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPauseProposed(), receipt!.blockNumber);
        const pauseId = (evs[evs.length - 1] as any).args.pauseId as string;

        await env.oracle.connect(env.bob).confirmEmergencyPause(pauseId);
        expect(await env.oracle.failedPauses(await badTarget.getAddress())).to.equal(true);
        expect(await okTarget.paused()).to.equal(true);
        expect(await env.oracle.failedPauseCount()).to.equal(1n);

        const okTarget2 = await (await ethers.getContractFactory("MockPausableSuccess")).deploy();
        await okTarget2.waitForDeployment();
        await env.oracle.connect(env.admin).registerPausable(await okTarget2.getAddress());
        const txClear = await env.oracle.connect(env.alice).proposeEmergencyPause([await okTarget2.getAddress()], "clear-list");
        const rClear = await txClear.wait();
        const evClear = await env.oracle.queryFilter(env.oracle.filters.EmergencyPauseProposed(), rClear!.blockNumber);
        const pauseId2 = (evClear[evClear.length - 1] as any).args.pauseId as string;
        await env.oracle.connect(env.bob).confirmEmergencyPause(pauseId2);
        expect(await env.oracle.failedPauseCount()).to.equal(0n);
    });
});
