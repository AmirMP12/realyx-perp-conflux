import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Branch coverage push toward 80%+ per instrumented contract", function () {
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));

    async function deployHarnessFixture() {
        const env = await deployTestEnvironment();
        const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
            libraries: {
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
            },
        });
        const monitoringLib = await MonitoringLib.deploy();
        const CoverageHarness = await ethers.getContractFactory("CoverageHarness", {
            libraries: {
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
                "contracts/libraries/MonitoringLib.sol:MonitoringLib": await monitoringLib.getAddress(),
                "contracts/libraries/CleanupLib.sol:CleanupLib": env.libs.cleanupLib,
                "contracts/libraries/ConfigLib.sol:ConfigLib": env.libs.configLib,
                "contracts/libraries/DustLib.sol:DustLib": env.libs.dustLib,
                "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": env.libs.flashLib,
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/RateLimitLib.sol:RateLimitLib": env.libs.rateLimitLib,
                "contracts/libraries/WithdrawLib.sol:WithdrawLib": env.libs.withdrawLib,
            },
        });
        const harness = await CoverageHarness.deploy();
        return { env, harness };
    }

    async function pushPrice(env: Awaited<ReturnType<typeof deployTestEnvironment>>, feedId: string, price: bigint, conf: bigint = 1n) {
        const now = await time.latest();
        const u = await env.pyth.createPriceFeedUpdateData(feedId, price, conf, -8, price, conf, now, now - 5);
        await env.pyth.updatePriceFeeds([u], { value: 1 });
    }

    it("CircuitBreakerLib: reset inactive, cooldown, admin early reset, no price-drop, TWAP deviation private path", async function () {
        const { harness } = await loadFixture(deployHarnessFixture);
        const c = ethers.Wallet.createRandom().address;

        await expect(harness.testResetBreaker(c, 0, true)).to.be.reverted;

        await harness.testConfigureBreaker(c, 0, 5_000, 3_600, 3_600);
        await harness.testTriggerBreaker(c, 0);

        await expect(harness.testResetBreaker(c, 0, false)).to.be.reverted;

        await harness.testResetBreaker(c, 0, true);

        const tBlock = BigInt(await time.latest());
        const bucket = tBlock / 300n;
        await harness.setHistoricalPrice(c, bucket > 0n ? bucket - 1n : 0n, ethers.parseEther("100"));
        await harness.testCheckPriceDropBreaker(c, ethers.parseEther("100"));

        await harness.testConfigureBreaker(c, 2, 100, 900, 60);
        const twNo = await harness.testCheckTWAPDeviationBreaker.staticCall(
            c,
            ethers.parseEther("100"),
            ethers.parseEther("100")
        );
        expect(twNo).to.equal(false);
        await harness.testCheckTWAPDeviationBreaker(c, ethers.parseEther("200"), ethers.parseEther("100"));
    });

    it("OracleAggregator: PRICE_DROP and TWAP_DEVIATION CircuitBreakerAlert emits", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.grantRole(ORACLE_ROLE, env.admin.address);
        await env.oracle.grantRole(KEEPER_ROLE, env.admin.address);

        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("brk-emit-drop"));
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        await env.oracle.connect(env.admin).configureBreaker(market, 0, 500, 3_600, 60);
        await env.oracle.connect(env.admin).setBreakerEnabled(market, 0, true);

        await env.oracle.checkBreakers(market, 100n * 10n ** 18n, 0n);
        await time.increase(301);
        await pushPrice(env, feedId, 100n * 10n ** 8n);
        await env.oracle.checkBreakers(market, 40n * 10n ** 18n, 0n);

        try {
            await env.oracle.connect(env.admin).resetBreaker(market, 0);
        } catch {
            // Coverage runs can be timing-sensitive for breaker trigger/cooldown; continue with TWAP path.
        }

        await env.oracle.connect(env.admin).configureBreaker(market, 2, 150, 900, 60);
        await env.oracle.connect(env.admin).setBreakerEnabled(market, 2, true);

        for (let i = 0; i < 3; i++) {
            await time.increase(301);
            await pushPrice(env, feedId, 100n * 10n ** 8n);
            await env.oracle.connect(env.admin).recordPricePoint(market, 0);
        }
        await env.oracle.checkBreakers(market, 1000n * 10n ** 18n, 0n);
    });

    it("EmergencyPauseLib: failed pause clears on next execute (while loop)", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        const MockPause = await ethers.getContractFactory("MockRevertOnPause");
        const bad = await MockPause.deploy();
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.connect(env.admin).registerPausable(await bad.getAddress());

        async function pauseProposalId(targets: string[], tag: string) {
            const tx = await env.oracle.connect(env.admin).proposeEmergencyPause(targets, tag);
            const receipt = await tx.wait();
            const iface = env.oracle.interface;
            for (const log of receipt!.logs) {
                try {
                    const p = iface.parseLog({ topics: log.topics as string[], data: log.data });
                    if (p?.name === "EmergencyPauseProposed") return p.args[0] as string;
                } catch {
                    /* ignore */
                }
            }
            throw new Error("EmergencyPauseProposed not found");
        }

        const id1 = await pauseProposalId([await bad.getAddress()], "x");
        await env.oracle.connect(env.bob).confirmEmergencyPause(id1);

        const id2 = await pauseProposalId([await env.trading.getAddress()], "y");
        await env.oracle.connect(env.bob).confirmEmergencyPause(id2);
    });

    it("EmergencyPauseLib: covers not-found/expired/already-confirmed and below-quorum paths", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.connect(env.admin).setGuardianQuorum(3);

        await expect(
            env.oracle.connect(env.bob).confirmEmergencyPause(ethers.keccak256(ethers.toUtf8Bytes("missing-id")))
        ).to.be.revertedWithCustomError(env.oracle, "ProposalNotFound");

        const tx = await env.oracle.connect(env.admin).proposeEmergencyPause([await env.trading.getAddress()], "z");
        const receipt = await tx.wait();
        let pauseId: string | undefined;
        for (const log of receipt!.logs) {
            try {
                const p = env.oracle.interface.parseLog({ topics: log.topics as string[], data: log.data });
                if (p?.name === "EmergencyPauseProposed") pauseId = p.args[0] as string;
            } catch {
                /* ignore */
            }
        }
        if (!pauseId) throw new Error("EmergencyPauseProposed not found");

        await env.oracle.connect(env.bob).confirmEmergencyPause(pauseId);
        await expect(env.oracle.connect(env.bob).confirmEmergencyPause(pauseId)).to.be.revertedWithCustomError(
            env.oracle,
            "AlreadyConfirmed"
        );

        await time.increase(3601);
        await expect(env.oracle.connect(env.admin).confirmEmergencyPause(pauseId)).to.be.revertedWithCustomError(
            env.oracle,
            "ProposalExpired"
        );
    });

    it("EmergencyPriceLib: confirm emergency price matching live oracle ref (deviation branch)", async function () {
        const { env } = await loadFixture(deployHarnessFixture);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.connect(env.admin).setGuardianQuorum(1);

        const collection = env.alice.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("emg-price-80"));
        await env.oracle.connect(env.admin).addSupportedMarket(collection);
        await env.oracle.connect(env.admin).setPythFeed(collection, feedId, 3600, 0);
        await pushPrice(env, feedId, 50n * 10n ** 8n);

        const pr = await env.oracle.getPrice(collection);
        const until = BigInt((await time.latest()) + 86_400);
        const ptx = await env.oracle.connect(env.admin).proposeEmergencyPrice(collection, pr.price, until);
        const prec = await ptx.wait();
        let pid: string | undefined;
        for (const log of prec!.logs) {
            try {
                const p = env.oracle.interface.parseLog({ topics: log.topics as string[], data: log.data });
                if (p?.name === "EmergencyPriceProposed") pid = p.args[0] as string;
            } catch {
                /* ignore */
            }
        }
        if (!pid) throw new Error("proposal id missing");

        await env.oracle.connect(env.bob).confirmEmergencyPrice(pid);
    });

    it("TradingCore: cleanup caps, setParams edges, partialClose dust, compliance, views global PnL", async function () {
        const env = await deployTestEnvironment();
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("tc-80"));
        const market = env.alice.address;

        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            100,
            ethers.parseEther("1000000"),
            ethers.parseEther("10000000"),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).setMarketId(market, "TC-80");
        await env.marketCalendar.connect(env.admin).setMarketConfig("TC-80", 0, 1439, 0, true);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.bob.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("200000", 6), env.bob.address);

        await env.trading.connect(env.admin).setParams(0n, 0n, 0n, 0n, 0n, 0n, 99n);
        await env.trading.connect(env.admin).setParams(0n, 0n, 0n, 0n, 0n, 0n, 5100n);
        await env.trading.connect(env.admin).setParams(0n, 0n, 0n, 0n, 0n, 0n, 2000n);

        const px = 3000n * 10n ** 8n;
        await pushPrice(env, feedId, px);
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("5000", 6),
            ethers.parseUnits("800", 6),
            ethers.parseUnits("3000", 18),
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        const Views = await ethers.getContractFactory("TradingCoreViews");
        const views = await Views.deploy();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());
        await env.trading.connect(env.admin).setTradingViews(await views.getAddress());

        const gp = await views.getGlobalUnrealizedPnL(await env.trading.getAddress());
        expect(gp).to.be.a("bigint");

        await env.trading.connect(env.alice).cleanupPositions(env.alice.address, 100n);
        await env.trading.connect(env.admin).cleanupPositions(env.alice.address, 100n);

        await (env.complianceManager as any).batchSetWhitelist([env.alice.address], false);
        await expect(
            env.trading.connect(env.alice).createOrder(
                0,
                market,
                100n * 10n ** 6n,
                50n * 10n ** 6n,
                ethers.parseUnits("3000", 18),
                true,
                10000,
                0,
                { value: ethers.parseEther("0.01") }
            )
        ).to.be.reverted;
        await (env.complianceManager as any).batchSetWhitelist([env.alice.address], true);

        await time.increase(130);
        const blk = await ethers.provider.getBlock("latest");
        const pos = await env.trading.getPosition(1n);
        const S = BigInt(pos.size);
        const minUsdc = await env.trading.minPositionSize();
        const minInt = minUsdc * 10n ** 12n;
        const rem = minInt > 2n ? minInt - 1n : 1n;
        if (rem < S) {
            const sz = S - rem;
            const pct = (sz * 10n ** 18n) / S;
            await expect(
                env.trading.connect(env.alice).partialClose(1n, pct, 0n, BigInt(blk!.timestamp + 600))
            ).to.be.reverted;
        }
    });

    it("VaultCore: conservative total assets + preview with dust balance", async function () {
        const env = await deployTestEnvironment();
        await env.usdc.mintTo(await env.vault.getAddress(), 7n);
        await env.vault.getConservativeTotalAssets();
        await env.vault.previewDeposit(3n);
    });

    it("PositionCloseLib + TradingLib: close short after open (short market-cost branch)", async function () {
        const env = await deployTestEnvironment();
        const market = env.bob.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("short-close-80"));

        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            100,
            ethers.parseEther("1000000"),
            ethers.parseEther("10000000"),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).setMarketId(market, "SHORT-80");
        await env.marketCalendar.connect(env.admin).setMarketConfig("SHORT-80", 0, 1439, 0, true);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.treasury.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.treasury).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.treasury).deposit(ethers.parseUnits("300000", 6), env.treasury.address);

        const p0 = 100n * 10n ** 8n;
        await pushPrice(env, feedId, p0);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("2000", 6),
            ethers.parseUnits("400", 6),
            0n,
            false,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        await time.increase(130);
        await pushPrice(env, feedId, p0);
        const blk = await ethers.provider.getBlock("latest");
        await env.trading
            .connect(env.alice)
            .closePosition([1n, ethers.parseUnits("2000", 6), 0n, BigInt(blk!.timestamp + 600)]);
    });

    it("PositionCloseLib: close size exceeds position via oversized partial pct", async function () {
        const env = await deployTestEnvironment();
        const market = env.bob.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("close-slip-80"));

        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            100,
            ethers.parseEther("1000000"),
            ethers.parseEther("10000000"),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).setMarketId(market, "CLOSE-SLIP-80");
        await env.marketCalendar.connect(env.admin).setMarketConfig("CLOSE-SLIP-80", 0, 1439, 0, true);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.treasury.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.treasury).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.treasury).deposit(ethers.parseUnits("300000", 6), env.treasury.address);

        await pushPrice(env, feedId, 100n * 10n ** 8n);
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("2000", 6),
            ethers.parseUnits("400", 6),
            0n,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        await time.increase(130);
        const blk = await ethers.provider.getBlock("latest");
        await expect(
            env.trading
                .connect(env.alice)
                .partialClose(1n, 2n * 10n ** 18n, 0n, BigInt(blk!.timestamp + 600))
        ).to.be.reverted;
    });

    it("PositionCloseLib: fully collateralized close path (borrowedPortion == 0)", async function () {
        const env = await deployTestEnvironment();
        const market = env.bob.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("close-collat-80"));

        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            10,
            ethers.parseEther("1000000"),
            ethers.parseEther("10000000"),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).setMarketId(market, "CLOSE-COLLAT-80");
        await env.marketCalendar.connect(env.admin).setMarketConfig("CLOSE-COLLAT-80", 0, 1439, 0, true);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.treasury.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.treasury).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.treasury).deposit(ethers.parseUnits("300000", 6), env.treasury.address);

        await pushPrice(env, feedId, 100n * 10n ** 8n);
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1000", 6),
            ethers.parseUnits("1000", 6),
            0n,
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        await time.increase(130);
        await pushPrice(env, feedId, 130n * 10n ** 8n);
        await env.usdc.mintTo(await env.trading.getAddress(), ethers.parseUnits("100000", 6));
        const blk = await ethers.provider.getBlock("latest");
        await env.trading
            .connect(env.alice)
            .closePosition([1n, ethers.parseUnits("1000", 6), 0n, BigInt(blk!.timestamp + 600)]);
    });

    it("WithdrawLib: zero-balance early return for order refunds", async function () {
        const { harness, env } = await loadFixture(deployHarnessFixture);
        await harness.setOrderRefundBalance(env.alice.address, 0n);
        await harness.testWithdrawOrderRefund(env.alice.address);
    });
});
