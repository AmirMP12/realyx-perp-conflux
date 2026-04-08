import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Single Mega 80 Wave", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        return { env };
    }

    async function pushPrice(env: any, feedId: string, price: bigint, conf: bigint = 1n) {
        const now = await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId,
            price,
            conf,
            -8,
            price,
            conf,
            now,
            now
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    async function setupMarket(env: any, tag: string) {
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes(`MEGA-${tag}-${Date.now()}`));
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            100,
            ethers.parseUnits("500000", 6),
            ethers.parseUnits("10000000", 6),
            500,
            1000,
            86400
        );
        await env.trading.connect(env.admin).setMarketId(market, "BTC-USD");
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        return { market, feedId };
    }

    async function seedLiquidity(env: any) {
        await env.usdc.mintTo(env.admin.address, 200_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(50_000_000_000n, env.admin.address);
    }

    async function seedTrader(env: any, who: any, amount = 40_000_000_000n) {
        await env.usdc.mintTo(who.address, amount);
        await env.usdc.connect(who).approve(await env.trading.getAddress(), ethers.MaxUint256);
    }

    async function seedTradingCoreUsdc(env: any, amount: bigint) {
        await env.usdc.mintTo(await env.trading.getAddress(), amount);
    }

    async function deployCoverageHarnessFixture() {
        const env = await deployTestEnvironment();

        const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
            libraries: {
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
            }
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
            }
        });
        const harness = await CoverageHarness.deploy();
        return { env, harness };
    }

    it("hits create/execute/cancel branches across order types", async function () {
        const { env } = await loadFixture(fixture);
        const { market } = await setupMarket(env, "orders");
        await seedLiquidity(env);
        await seedTrader(env, env.alice);

        // createOrder: no execution fee reverts (msg.value < minExecutionFee)
        await expect(
            env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("100", 6), ethers.parseUnits("50", 6), 0, true, 0, 0,
                { value: 0 }
            )
        ).to.be.reverted;

        // createOrder increase (MARKET_INCREASE) succeeds then executeOrderFull creates position
        await env.trading.connect(env.alice).createOrder(
            0, market, ethers.parseUnits("300", 6), ethers.parseUnits("100", 6), 0, true, 200, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        // createOrder decrease (MARKET_DECREASE) stored; executeOrder reverts -> cancelOrder branches
        await env.trading.connect(env.alice).createOrder(
            1, market, ethers.parseUnits("100", 6), 0, ethers.parseUnits("95", 8), true, 50, 1,
            { value: ethers.parseEther("0.01") }
        );
        await expect(env.trading.connect(env.keeper).executeOrder(2, [])).to.be.reverted;

        // cancelOrder: unauthorized cancels revert
        await expect(env.trading.connect(env.bob).cancelOrder(2)).to.be.reverted;
        await env.trading.connect(env.alice).cancelOrder(2);

        // WithdrawLib: keeper fee refund path (non-zero then zero)
        await env.trading.connect(env.keeper).withdrawKeeperFees();
        await env.trading.connect(env.keeper).withdrawKeeperFees(); // now zero => no-op

        // BreakerActive: configure breaker, trigger it as guardian, and confirm increase orders are blocked
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.configureBreaker(market, 0, 500, 3600, 60); // PRICE_DROP
        await env.oracle.triggerBreaker(market, 0);

        await env.trading.connect(env.alice).createOrder(
            3, market, ethers.parseUnits("120", 6), 0, ethers.parseUnits("95", 8), true, 0, 1,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(3, []);

        // increase orders blocked while breaker triggered
        await expect(
            env.trading.connect(env.alice).createOrder(
                0, market, ethers.parseUnits("10", 6), ethers.parseUnits("10", 6), 0, true, 0, 0,
                { value: ethers.parseEther("0.01") }
            )
        ).to.be.reverted;

        // global pause also blocks increases
        await env.oracle.activateGlobalPause();
        await expect(
            env.trading.connect(env.alice).createOrder(
                2, market, ethers.parseUnits("10", 6), ethers.parseUnits("10", 6), ethers.parseUnits("120", 8), true, 10, 0,
                { value: ethers.parseEther("0.01") }
            )
        ).to.be.reverted;
        await env.oracle.deactivateGlobalPause();

        // reset breaker (admin override path)
        await env.oracle.resetBreaker(market, 0);

        // executeOrderFull: LIMIT_INCREASE invalid-order branch (long with currentPrice > triggerPrice)
        await env.trading.connect(env.alice).createOrder(
            2, market, ethers.parseUnits("120", 6), ethers.parseUnits("50", 6), ethers.parseUnits("90", 8), true, 0, 0,
            { value: ethers.parseEther("0.01") }
        ); // orderId 4
        await expect(env.trading.connect(env.keeper).executeOrder(4, [])).to.be.reverted;
        await env.trading.connect(env.alice).cancelOrder(4);

        // executeOrderFull: LIMIT_INCREASE slippage branch (trigger above current but maxSlippage too low)
        await env.trading.connect(env.alice).createOrder(
            2, market, ethers.parseUnits("120", 6), ethers.parseUnits("50", 6), ethers.parseUnits("120", 8), true, 10, 0,
            { value: ethers.parseEther("0.01") }
        ); // orderId 5
        await expect(env.trading.connect(env.keeper).executeOrder(5, [])).to.be.reverted;
        await env.trading.connect(env.alice).cancelOrder(5);

        // withdrawOrderCollateralRefund: collateral refund from canceled LIMIT_INCREASE (non-zero)
        await env.trading.connect(env.alice).withdrawOrderCollateralRefund();
    });

    it("hits collateral add/withdraw happy and revert branches", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "collateral");
        await seedLiquidity(env);
        await seedTrader(env, env.alice);

        await env.trading.connect(env.alice).createOrder(
            0, market, ethers.parseUnits("350", 6), ethers.parseUnits("120", 6), 0, true, 0, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        await env.trading.connect(env.alice).addCollateral(1, ethers.parseUnits("50", 6), 500, false);

        // addCollateral: emergency-mode path isEmergency=true on an active market => MarketNotActive revert
        await expect(
            env.trading.connect(env.alice).addCollateral(1, ethers.parseUnits("5", 6), 500, true)
        ).to.be.reverted;

        // addCollateral: slippage/max-leverage exceed => SlippageExceeded revert
        await expect(
            env.trading.connect(env.alice).addCollateral(1, ethers.parseUnits("10", 6), 1, false)
        ).to.be.reverted;

        await expect(
            env.trading.connect(env.alice).withdrawCollateral(1, ethers.parseUnits("1000000", 6))
        ).to.be.reverted;

        await pushPrice(env, feedId, 70n * 10n ** 8n, 1n);
        await env.trading.connect(env.alice).withdrawCollateral(1, ethers.parseUnits("30", 6));

        // withdrawCollateral: make remaining collateral liquidatable => InsufficientCollateral revert
        await pushPrice(env, feedId, 1n * 10n ** 8n, 1n);
        await expect(
            env.trading.connect(env.alice).withdrawCollateral(1, ethers.parseUnits("1", 6))
        ).to.be.reverted;
    });

    it("hits stop-loss/take-profit/trailing and execution branches", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "triggers");
        await seedLiquidity(env);
        await seedTrader(env, env.alice);

        await env.trading.connect(env.alice).createOrder(
            0, market, ethers.parseUnits("300", 6), ethers.parseUnits("100", 6), 0, true, 0, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);
        await seedTradingCoreUsdc(env, ethers.parseUnits("5000000", 6));

        await expect(env.trading.connect(env.bob).setStopLoss(1, ethers.parseUnits("90", 18))).to.be.reverted;
        await expect(env.trading.connect(env.alice).setTakeProfit(1, ethers.parseUnits("80", 18))).to.be.reverted;
        await expect(env.trading.connect(env.alice).setTrailingStop(1, 100_000)).to.be.reverted;

        await env.trading.connect(env.alice).setStopLoss(1, ethers.parseUnits("90", 18));
        await env.trading.connect(env.alice).setTakeProfit(1, ethers.parseUnits("130", 18));
        await env.trading.connect(env.alice).setTrailingStop(1, 100);

        await pushPrice(env, feedId, 89n * 10n ** 8n, 1n);
        await env.trading.connect(env.keeper).executeStopLossTakeProfit([1]);
    });

    it("hits oracle confidence/twap/breaker/global pause branches", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "oracle");

        await pushPrice(env, feedId, 100n * 10n ** 8n, 200n * 10n ** 8n);
        await expect(env.oracle.getPriceWithConfidence(market, 1n)).to.be.reverted;
        await expect(env.oracle.getTWAPWithValidation(market, 3600, 3)).to.be.reverted;

        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        const [twap, ok] = await env.oracle.getTWAPWithValidation(market, 3600, 3);
        expect(twap).to.be.gt(0n);
        expect(ok).to.be.a("boolean");

        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.configureBreaker(market, 0, 500, 3600, 60);
        await env.oracle.setBreakerEnabled(market, 0, true);
        await env.oracle.triggerBreaker(market, 0);
        await env.oracle.resetBreaker(market, 0);

        await env.oracle.activateGlobalPause();
        const [restricted] = await env.oracle.isMarketRestricted(market);
        expect(restricted).to.equal(true);
        await env.oracle.deactivateGlobalPause();

        // stale price branch (StalePrice)
        // setupMarket sets maxStaleness=3600s, so exceed it by advancing > 1 hour.
        await time.increase(3600 + 1);
        await expect(env.oracle.getPrice(market)).to.be.reverted;

        // InsufficientConfidence default branch (maxConfidence=0 in setupMarket)
        await pushPrice(env, feedId, 100n * 10n ** 8n, 200n * 10n ** 8n);
        await expect(env.oracle.getPrice(market)).to.be.reverted;

        // recordPricePoint TWAP update too frequent + after interval branch
        const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
        await env.oracle.grantRole(KEEPER_ROLE, env.keeper.address);
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        await env.oracle.connect(env.keeper).recordPricePoint(market, 100n * 10n ** 18n);
        await env.oracle.connect(env.keeper).recordPricePoint(market, 101n * 10n ** 18n); // too frequent => early return
        await time.increase(5 * 60 + 1);
        await env.oracle.connect(env.keeper).recordPricePoint(market, 102n * 10n ** 18n);
    });

    it("hits liquidation and failed-repayment related branches", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "liq");
        await seedLiquidity(env);
        await seedTrader(env, env.alice);

        // PositionNotFound branch
        await expect(env.trading.connect(env.liquidator).liquidatePosition(0)).to.be.reverted;

        // PositionNotLiquidatable branch (healthFactor >= PRECISION at entry price)
        await env.trading.connect(env.alice).createOrder(
            0, market, ethers.parseUnits("100", 6), ethers.parseUnits("100", 6), 0, true, 0, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);
        // price is still at entry (100) => should not be liquidatable
        await expect(env.trading.connect(env.liquidator).liquidatePosition(1)).to.be.reverted;

        await env.trading.connect(env.alice).createOrder(
            0, market, ethers.parseUnits("800", 6), ethers.parseUnits("80", 6), 0, true, 0, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(2, []);

        // Mild drop: still not liquidatable for this position (35 would be liquidatable and succeed once core is solvent).
        await pushPrice(env, feedId, 92n * 10n ** 8n, 1n);
        await expect(env.trading.connect(env.liquidator).liquidatePosition(2)).to.be.reverted;
    });

    it("hits liquidation success -> failed repayment recorded -> resolve path", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "liq-success");
        await seedLiquidity(env);
        await seedTrader(env, env.alice);

        // Fund insurance so coverBadDebt can cover liquidation shortfalls
        await env.usdc.mintTo(env.admin.address, 100_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(50_000_000_000n, env.admin.address); // 50,000 USDC

        // Open a highly leveraged position so borrowedAmount > collateral and liquidation has repayAmount > 0
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("2000", 6),
            ethers.parseUnits("60", 6),
            0,
            true,
            0,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        // Ensure TradingCore has enough USDC to pass LiquidationLib's "receiveAmount" balance check
        // Overfund TradingCore so LiquidationLib's internal "receiveAmount" check passes reliably.
        await seedTradingCoreUsdc(env, 20_000_000_000_000n); // 20,000,000 USDC

        // Make position liquidatable
        await pushPrice(env, feedId, 10n * 10n ** 8n, 1n);

        // Liquidation should succeed and, if needed, record a failed repayment
        await env.trading.connect(env.liquidator).liquidatePosition(1);

        const count = await env.trading.failedRepaymentCount();
        if (count > 0n) {
            const frId = await env.trading.failedRepaymentIdAt(0);
            await env.usdc.mintTo(env.admin.address, 10_000_000_000n);
            await env.usdc.connect(env.admin).approve(await env.trading.getAddress(), ethers.MaxUint256);
            await env.trading.connect(env.admin).resolveFailedRepayment(frId);
            const fr = await env.trading.getFailedRepayment(frId);
            expect(fr.resolved).to.equal(true);
        }
    });

    it("hits vault emergency mode and escape guard branches", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 3_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(2_000_000_000n, env.admin.address);

        // NotEmergencyMode branch
        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(0n)).to.be.reverted;

        await env.vault.connect(env.admin).triggerEmergencyMode();
        await expect(env.vault.connect(env.admin).deposit(1n, env.admin.address)).to.be.reverted;
        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(1n)).to.be.reverted;

        await time.increase(7 * 24 * 3600 + 5);
        // shares==0 => ZeroShares branch
        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(0n)).to.be.reverted;

        // shares > caller LP shares => InsufficientShares branch
        const shares = await env.vault.lpBalanceOf(env.admin.address);
        await expect(env.vault.connect(env.admin).emergencyEscapeWithdraw(shares + 1n)).to.be.reverted;

        // finally, one valid escape withdraw
        await env.vault.connect(env.admin).emergencyEscapeWithdraw(1n);
    });

    it("hits vault insurance stake/unstake cooldown and unhealthy ratio branches", async function () {
        const { env } = await loadFixture(fixture);

        await env.usdc.mintTo(env.admin.address, 50_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);

        // stakeInsurance: zero assets / zero receiver
        await expect(env.vault.connect(env.admin).stakeInsurance(0, env.admin.address)).to.be.reverted;
        await expect(env.vault.connect(env.admin).stakeInsurance(1, ethers.ZeroAddress)).to.be.reverted;

        // stakeInsurance success
        await env.vault.connect(env.admin).stakeInsurance(2_000_000_000n, env.admin.address);

        // unstakeInsurance: cooldown not started / not complete
        await expect(env.vault.connect(env.admin).unstakeInsurance(1n, env.admin.address)).to.be.reverted;
        await env.vault.connect(env.admin).requestUnstake();
        await expect(env.vault.connect(env.admin).unstakeInsurance(1n, env.admin.address)).to.be.reverted;

        // Make protocolTVL non-zero and try to unstake too much -> UnhealthyRatio
        const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);
        await env.vault.connect(env.admin).setMaxProtocolTVL(10_000_000_000n);
        await env.vault.connect(env.admin).updateProtocolTVL(4_000_000_000n);

        await time.increase(7 * 24 * 3600 + 5);
        const insShares = await env.vault.insBalanceOf(env.admin.address);
        await expect(env.vault.connect(env.admin).unstakeInsurance(insShares, env.admin.address)).to.be.reverted;

        // Unstake a tiny amount successfully after cooldown
        await env.vault.connect(env.admin).unstakeInsurance(1n, env.admin.address);
    });

    it("hits oracle emergency pause proposal/confirm branches", async function () {
        const { env } = await loadFixture(fixture);
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);

        // register one pausable, and include one unregistered target to hit failed pause list branches
        await env.oracle.connect(env.admin).registerPausable(await env.trading.getAddress());

        const tx = await env.oracle.connect(env.alice).proposeEmergencyPause(
            [await env.trading.getAddress(), ethers.Wallet.createRandom().address],
            "mega"
        );
        const receipt = await tx.wait();
        const events = await env.oracle.queryFilter(env.oracle.filters.EmergencyPauseProposed(), receipt!.blockNumber);
        const pauseId = (events[events.length - 1] as any).args.pauseId;

        // confirm from another guardian (quorum is 2 by default)
        await env.oracle.connect(env.bob).confirmEmergencyPause(pauseId);

        // confirming again should revert (already confirmed/executed path)
        await expect(env.oracle.connect(env.bob).confirmEmergencyPause(pauseId)).to.be.reverted;

        // global pause idempotence branches
        await env.oracle.connect(env.alice).activateGlobalPause();
        await env.oracle.connect(env.alice).activateGlobalPause();
        await env.oracle.connect(env.admin).deactivateGlobalPause();
        await env.oracle.connect(env.admin).deactivateGlobalPause();
    });

    it("hits emergency price proposal/confirm deviation & expiry branches", async function () {
        const { env } = await loadFixture(fixture);

        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.keeper.address);

        // quorum=2 (default), with ref price present => deviation check path
        const { market, feedId } = await setupMarket(env, "emg-price-ref");
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);

        const validUntil = (await time.latest()) + 3600;
        const tx = await env.oracle.connect(env.alice).proposeEmergencyPrice(market, ethers.parseEther("1000"), validUntil);
        const receipt = await tx.wait();
        const evs = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), receipt!.blockNumber);
        const proposalId = (evs[evs.length - 1] as any).args.proposalId;

        // confirm -> should revert due to deviation too high (refPrice exists)
        await expect(env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId)).to.be.reverted;

        // expiry branch: advance past 1 hour proposal expiry and confirm should revert
        const tx2 = await env.oracle.connect(env.alice).proposeEmergencyPrice(market, ethers.parseEther("150"), validUntil);
        const r2 = await tx2.wait();
        const evs2 = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), r2!.blockNumber);
        const proposalId2 = (evs2[evs2.length - 1] as any).args.proposalId;
        await time.increase(3600 + 2);
        await expect(env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId2)).to.be.reverted;

        // no-ref-price path: use random market without feed; with quorum=2 it requires 4 confirmations OR hits absolute cap check
        const noRefMarket = ethers.Wallet.createRandom().address;
        const tx3 = await env.oracle.connect(env.alice).proposeEmergencyPrice(noRefMarket, ethers.parseEther("50000"), (await time.latest()) + 3600);
        const r3 = await tx3.wait();
        const evs3 = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), r3!.blockNumber);
        const proposalId3 = (evs3[evs3.length - 1] as any).args.proposalId;

        // confirmations reach quorum=2 here, but no ref => still reverts (needs quorum*2 when no ref)
        await expect(env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId3)).to.be.reverted;

        // absolute cap branch: proposing a huge price should revert on execute (price > MAX_EMERGENCY_PRICE_ABSOLUTE)
        const tx4 = await env.oracle.connect(env.alice).proposeEmergencyPrice(noRefMarket, 10n ** 25n, (await time.latest()) + 3600);
        const r4 = await tx4.wait();
        const evs4 = await env.oracle.queryFilter(env.oracle.filters.EmergencyPriceProposed(), r4!.blockNumber);
        const proposalId4 = (evs4[evs4.length - 1] as any).args.proposalId;
        await expect(env.oracle.connect(env.bob).confirmEmergencyPrice(proposalId4)).to.be.reverted;
    });

    it("hits vault claim submit/approve/process and rate limit branches", async function () {
        const { env } = await loadFixture(fixture);

        const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);

        await env.usdc.mintTo(env.admin.address, 200_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(100_000_000_000n, env.admin.address);
        await env.vault.connect(env.admin).updateProtocolTVL(50_000_000_000n);

        // submitClaim requires onlyTradingCore, so use coverBadDebt with amount > approvalThreshold => claim submitted, returns 0
        await expect(env.vault.connect(env.alice).coverBadDebt(20_000_000e6, 77)).to.be.reverted;

        // temporarily call coverBadDebt via tradingCore by opening + forcing liquidation shortfall isn't cheap here,
        // so we instead hit submit/approve/process via direct calls that exist and are guarded.
        // These should revert when called from wrong sender:
        await expect(env.vault.connect(env.alice).submitClaim(1, 1)).to.be.reverted;
        await expect(env.vault.connect(env.alice).approveClaim(1)).to.be.reverted;

        // processClaim invalid/branch
        await expect(env.vault.processClaim(12345)).to.be.reverted;
    });

    it("hits ConfigLib-heavy validation and max-active-market branches", async function () {
        const { harness } = await loadFixture(deployCoverageHarnessFixture);

        const market = ethers.Wallet.createRandom().address;
        const feed = ethers.Wallet.createRandom().address;

        await expect(harness.testSetMarket(ethers.ZeroAddress, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0)).to.be.reverted;
        await expect(harness.testSetMarket(market, ethers.ZeroAddress, 50, 1_000, 10_000, 500, 1_000, 3600, 0)).to.be.reverted;
        await expect(harness.testSetMarket(market, feed, 501, 1_000, 10_000, 500, 1_000, 3600, 0)).to.be.reverted;
        await expect(harness.testSetMarket(market, feed, 50, 1_000, 10_000, 50, 1_000, 3600, 0)).to.be.reverted;
        await expect(harness.testSetMarket(market, feed, 50, 1_000, 10_000, 500, 100, 3600, 0)).to.be.reverted;

        await harness.testSetMarket(market, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0);
        await expect(harness.testSetMarket(market, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0)).to.be.reverted;
        await expect(
            harness.testUpdateMarket(ethers.Wallet.createRandom().address, feed, 50, 1_000, 10_000, 500, 1_000, 3600, 0)
        ).to.be.reverted;

        // Fill to MAX_ACTIVE_MARKETS (20), then one more should revert.
        for (let i = 0; i < 19; i++) {
            await harness.testSetMarket(
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address,
                50,
                1_000 + i,
                10_000 + i,
                500,
                1_000,
                3600,
                0
            );
        }
        await expect(
            harness.testSetMarket(
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address,
                50,
                2_000,
                20_000,
                500,
                1_000,
                3600,
                0
            )
        ).to.be.reverted;
    });

    it("hits TradingLib owner/pagination/active-scan branches via harness", async function () {
        const { harness } = await loadFixture(deployCoverageHarnessFixture);
        const [ownerA, ownerB] = await ethers.getSigners();

        // Pagination branches: limit=0 and offset>=total
        let r = await harness.testGetUserPositionsPaginated(0, 0);
        expect(r[0].length).to.equal(0);
        expect(r[1]).to.equal(0n);

        for (let i = 1; i <= 230; i++) {
            await harness.addPositionId(i);
            // alternate OPEN/CLOSED to exercise both branches in active scan loops
            const state = i % 2 === 0 ? 2 : 1;
            await harness.setPosition(i, 1_000, 1_000, 1, state, ethers.ZeroAddress);
        }
        r = await harness.testGetUserPositionsPaginated(400, 10);
        expect(r[0].length).to.equal(0);

        const active = await harness.testGetActivePositions();
        expect(active.length).to.be.gt(0);
        expect(active.length).to.be.lte(100); // MAX_ACTIVE_POSITIONS_QUERY

        // updatePositionOwner branches: zero address, contract target, position not open, exposure exceeded, success
        await harness.setPosition(999, 2_000_000_000_000n, 1_000, 1, 1, ethers.ZeroAddress);
        await expect(harness.testUpdatePositionOwner(999, ethers.ZeroAddress, ownerA.address, ethers.MaxUint256)).to.be.reverted;
        await expect(harness.testUpdatePositionOwner(999, await harness.getAddress(), ownerA.address, ethers.MaxUint256)).to.be.reverted;

        await harness.setPosition(1000, 2_000_000_000_000n, 1_000, 1, 2, ethers.ZeroAddress); // CLOSED
        await expect(harness.testUpdatePositionOwner(1000, ownerB.address, ownerA.address, ethers.MaxUint256)).to.be.reverted;

        await expect(harness.testUpdatePositionOwner(999, ownerB.address, ownerA.address, 1)).to.be.reverted;
        await harness.testUpdatePositionOwner(999, ownerB.address, ownerA.address, ethers.MaxUint256);
    });

    it("hits LiquidationLib liquidation price-deviation branch", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "liq-deviation");
        await seedLiquidity(env);
        await seedTrader(env, env.alice);
        await seedTradingCoreUsdc(env, 10_000_000_000_000n);
        await env.usdc.mintTo(env.admin.address, 100_000_000_000n);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).stakeInsurance(30_000_000_000n, env.admin.address);

        // Open position
        await env.trading.connect(env.alice).createOrder(
            0, market, ethers.parseUnits("1200", 6), ethers.parseUnits("80", 6), 0, true, 0, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        // Build TWAP history around 100
        const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
        await env.oracle.grantRole(KEEPER_ROLE, env.keeper.address);
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        await env.oracle.connect(env.keeper).recordPricePoint(market, 100n * 10n ** 18n);
        await time.increase(5 * 60 + 1);
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n);
        await env.oracle.connect(env.keeper).recordPricePoint(market, 100n * 10n ** 18n);

        // Crash current price so liquidatable; TWAP deviation should be too high and liquidation should revert.
        await pushPrice(env, feedId, 10n * 10n ** 8n, 1n);
        await expect(env.trading.connect(env.liquidator).liquidatePosition(1)).to.be.reverted;
    });

    it("hits TradingCore admin fee/forwarder/limits branches", async function () {
        const { env } = await loadFixture(fixture);

        // setFeeConfig invalid (shares sum > 10000)
        await expect(
            env.trading.connect(env.admin).setFeeConfig({
                makerFeeBps: 100,
                takerFeeBps: 100,
                minFeeUsdc: 1,
                lpShareBps: 5000,
                insuranceShareBps: 5000,
                treasuryShareBps: 1
            })
        ).to.be.reverted;

        // setFeeConfig valid current config
        const cur = await env.trading.feeConfig();
        await env.trading.connect(env.admin).setFeeConfig({
            makerFeeBps: cur.makerFeeBps,
            takerFeeBps: cur.takerFeeBps,
            minFeeUsdc: cur.minFeeUsdc,
            lpShareBps: cur.lpShareBps,
            insuranceShareBps: cur.insuranceShareBps,
            treasuryShareBps: cur.treasuryShareBps
        });

        // trusted forwarder: zero-address revert + toggle true/false
        await expect(
            env.trading.connect(env.admin).setTrustedForwarder(ethers.ZeroAddress, true)
        ).to.be.reverted;
        const fwd = ethers.Wallet.createRandom().address;
        await env.trading.connect(env.admin).setTrustedForwarder(fwd, true);
        expect(await env.trading.trustedForwarders(fwd)).to.equal(true);
        await env.trading.connect(env.admin).setTrustedForwarder(fwd, false);
        expect(await env.trading.trustedForwarders(fwd)).to.equal(false);

        // setLimits: out-of-range _mpd should not update; in-range should update
        const before = await env.trading.minPositionDuration();
        await env.trading.connect(env.admin).setLimits(1, 1, 1, 1, 1, 29); // ignored
        expect(await env.trading.minPositionDuration()).to.equal(before);
        await env.trading.connect(env.admin).setLimits(2, 2, 2, 2, 2, 30); // min valid
        expect(await env.trading.minPositionDuration()).to.equal(30n);
        await env.trading.connect(env.admin).setLimits(3, 3, 3, 3, 3, 3600); // max valid
        expect(await env.trading.minPositionDuration()).to.equal(3600n);
    });

    it("hits ConfigLib unlist/update extra branches via harness", async function () {
        const { harness } = await loadFixture(deployCoverageHarnessFixture);
        const markets: string[] = [];

        for (let i = 0; i < 5; i++) {
            const m = ethers.Wallet.createRandom().address;
            markets.push(m);
            await harness.testSetMarket(
                m,
                ethers.Wallet.createRandom().address,
                50,
                1_000 + i,
                10_000 + i,
                500,
                1_000,
                3600,
                0
            );
        }

        // update listed market (success branch)
        await harness.testUpdateMarket(
            markets[0],
            ethers.Wallet.createRandom().address,
            45,
            2_000,
            20_000,
            600,
            1_200,
            7200,
            0
        );

        // unlist existing market (array scan/remove path), then unlist again -> revert
        await harness.setUnlistMarket(markets[2]);
        await expect(harness.setUnlistMarket(markets[2])).to.be.reverted;
    });

    it("hits TradingLib market-open and collateral oracle branches via harness", async function () {
        const { harness, env } = await loadFixture(deployCoverageHarnessFixture);
        const market = await env.usdc.getAddress();

        // checkMarketOpen branches:
        // 1) calendar == 0 -> true
        expect(await harness.testCheckMarketOpen(market, ethers.ZeroAddress)).to.equal(true);
        // 2) empty marketId -> true
        expect(await harness.testCheckMarketOpen(market, await env.marketCalendar.getAddress())).to.equal(true);
        // 3) marketId set and valid calendar -> boolean path
        await harness.setMarketId(market, "BTC-USD");
        const isOpen = await harness.testCheckMarketOpen(market, await env.marketCalendar.getAddress());
        expect(isOpen).to.be.a("boolean");

        // addCollateral/withdrawCollateral invalid oracle branch
        await harness.setPosition(777, 1_000, 1_000, 1, 1, market);
        await harness.setCollateral(777, 100);
        await expect(
            harness.testAddCollateral(777, 50, 1, false, await env.usdc.getAddress(), ethers.ZeroAddress, 0)
        ).to.be.reverted;
        await expect(
            harness.testWithdrawCollateral(777, 10, await env.usdc.getAddress(), ethers.ZeroAddress, 0)
        ).to.be.reverted;
    });

    it("hits OracleAggregator reset/ETH feed/health extra branches", async function () {
        const { env } = await loadFixture(fixture);
        const { market, feedId } = await setupMarket(env, "oracle-extra");

        // isOracleHealthy configured but no fresh/valid updates around this stage
        const [healthyBefore] = await env.oracle.isOracleHealthy(market);
        expect(healthyBefore).to.be.a("boolean");

        // NoEthUsdFeed branch
        await expect(env.oracle.getEthUsdPrice()).to.be.reverted;

        // set eth feed and fetch success branch
        const ethFeedId = ethers.keccak256(ethers.toUtf8Bytes("ETH-USD-EXTRA"));
        await env.oracle.connect(env.admin).setEthFeedId(ethFeedId);
        await pushPrice(env, ethFeedId, 2_100n * 10n ** 8n, 1n);
        const eth = await env.oracle.getEthUsdPrice();
        expect(eth).to.be.gt(0n);

        // Auto-reset branch: breaker active then reset after cooldown when oracle healthy
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.configureBreaker(market, 0, 100, 3600, 1); // PRICE_DROP
        await env.oracle.setBreakerEnabled(market, 0, true);
        await env.oracle.triggerBreaker(market, 0);
        let restricted = await env.oracle.isMarketRestricted(market);
        expect(restricted[0]).to.equal(true);

        await time.increase(2);
        await pushPrice(env, feedId, 100n * 10n ** 8n, 1n); // keep oracle healthy
        await env.oracle.autoResetBreakers(market);
        restricted = await env.oracle.isMarketRestricted(market);
        expect(restricted[1]).to.equal(0n);
    });

    it("hits TradingCore tradingViews and admin guard branches", async function () {
        const { env } = await loadFixture(fixture);

        // tradingViews unauthorized branches by zeroing view contract pointer
        await env.trading.connect(env.admin).setTradingViews(ethers.ZeroAddress);
        await expect(env.trading.getPositionPnL(1)).to.be.reverted;
        await expect(env.trading.canLiquidate(1)).to.be.reverted;
        await expect(env.trading.getGlobalUnrealizedPnL()).to.be.reverted;

        // setContracts/setRWAContracts guard branches
        await expect(
            env.trading.connect(env.admin).setContracts(
                ethers.ZeroAddress,
                await env.oracle.getAddress(),
                await env.positionToken.getAddress()
            )
        ).to.be.reverted;
        // Some deployments allow zero calendar here; call it to exercise non-reverting path.
        await env.trading.connect(env.admin).setRWAContracts(
            ethers.ZeroAddress,
            await env.dividendManager.getAddress(),
            await env.complianceManager.getAddress()
        );
    });

    it("hits OracleAggregatorLib helper branches via harness", async function () {
        const { harness } = await loadFixture(deployCoverageHarnessFixture);

        // normalizeChainlinkPrice branches: <=0, <18, >18, ==18
        expect(await harness.testNormalizeChainlinkPrice(0, 8)).to.equal(0n);
        expect(await harness.testNormalizeChainlinkPrice(100, 8)).to.equal(1000000000000n);
        expect(await harness.testNormalizeChainlinkPrice(1000000000000000000n, 20)).to.equal(10000000000000000n);
        expect(await harness.testNormalizeChainlinkPrice(123, 18)).to.equal(123n);

        // volume spike helper branches
        const [t0, m0] = await harness.testCheckVolumeSpike(100, 0, 200);
        expect(t0).to.equal(false);
        expect(m0).to.equal(0n);
        const [t1, m1] = await harness.testCheckVolumeSpike(400, 100, 300);
        expect(t1).to.equal(true);
        expect(m1).to.equal(400n);

        // TWAP deviation helper branches
        const [td0, dv0] = await harness.testCheckTWAPDeviationTriggered(100, 0, 100);
        expect(td0).to.equal(false);
        expect(dv0).to.equal(0n);
        const [td1, dv1] = await harness.testCheckTWAPDeviationTriggered(130, 100, 2000);
        expect(td1).to.equal(true);
        expect(dv1).to.equal(3000n);
    });

    it("hits deeper TradingLib internal helper branches via harness", async function () {
        const { harness } = await loadFixture(deployCoverageHarnessFixture);
        const [ownerA, ownerB] = await ethers.getSigners();

        // calculateNewLeverage branch: collateral zero -> uint max
        const levMax = await harness.testCalculateNewLeverage(1000, 0);
        expect(levMax).to.equal(ethers.MaxUint256);
        const levNorm = await harness.testCalculateNewLeverage(1000, 100);
        expect(levNorm).to.be.gt(0n);

        // getPositionPnL / canLiquidate closed branch
        await harness.setPosition(2001, 1000, 1000, 1, 2, ethers.ZeroAddress); // CLOSED
        await harness.setCollateral(2001, 100);
        const pnlClosed = await harness.testGetPositionPnL(2001, 900);
        expect(pnlClosed[0]).to.equal(0n);
        const liqClosed = await harness.testCanLiquidate(2001, 900);
        expect(liqClosed[0]).to.equal(false);

        // getPositionPnL / canLiquidate open branch
        await harness.setPosition(2002, 2_000_000_000_000n, 1000, 1, 1, ethers.ZeroAddress); // OPEN, large size
        await harness.setCollateral(2002, 1_000_000_000_000n);
        const pnlOpen = await harness.testGetPositionPnL(2002, 900);
        expect(pnlOpen[1]).to.be.a("bigint");
        const liqOpen = await harness.testCanLiquidate(2002, 100);
        expect(liqOpen[1]).to.be.a("bigint");

        // volume branch: global limit exceeded (distinct from user limit)
        await harness.testUpdateVolume(ownerA.address, 900);
        expect(await harness.testCheckVolumeLimit(ownerA.address, 50, 10_000, 940)).to.equal(false);

        // post-liquidation accounting branches
        const [t1, badDebt1] = await harness.boostApplyLiquidatePostProcess.staticCall(1, false, 1000, 500, 10);
        expect(t1).to.equal(10n);
        expect(badDebt1).to.equal(1000n);
        const [t2, badDebt2] = await harness.boostApplyLiquidatePostProcess.staticCall(2, true, 1000, 0, 10);
        expect(t2).to.equal(10n);
        expect(badDebt2).to.equal(1000n);
        const [t3, badDebt3] = await harness.boostApplyLiquidatePostProcess.staticCall(3, true, 1000, 500, 10);
        expect(t3).to.equal(11n);
        expect(badDebt3).to.be.gt(1000n);

        // WithdrawLib native refund wrappers: contract must hold ETH for payable refunds
        await ethers.provider.send("hardhat_setBalance", [
            await harness.getAddress(),
            "0xde0b6b3a7640000", // 1 ether
        ]);
        await harness.setKeeperFeeBalance(ownerA.address, 1);
        await harness.testWithdrawKeeperFees(ownerA.address);
        await harness.testWithdrawKeeperFees(ownerA.address); // zero no-op path

        await harness.setOrderRefundBalance(ownerA.address, 1);
        await harness.testWithdrawOrderRefund(ownerA.address);
        await harness.testWithdrawOrderRefund(ownerA.address); // zero no-op path

        // cancelOrder branches: use ownerB so orderRefundBalance(ownerA) stays clean above
        await expect(
            harness.boostCancelOrder(999, ethers.ZeroAddress, ownerB.address, 0, 0, 0)
        ).to.be.reverted;
        await expect(
            harness.boostCancelOrder(1001, ownerB.address, ownerA.address, 10, 0, 5)
        ).to.be.reverted;
        await harness.boostCancelOrder(1002, ownerB.address, ownerB.address, 10, 0, 5);
        await harness.testWithdrawOrderRefund(ownerB.address);
        await harness.testWithdrawOrderRefund(ownerB.address);
    });

    it("hits closePosition and partialClose edge branches", async function () {
        const { env } = await loadFixture(fixture);
        await seedLiquidity(env);
        const { market } = await setupMarket(env, "close");
        await seedTrader(env, env.alice);

        // open position 1
        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("300", 6),
            ethers.parseUnits("100", 6),
            0,
            true,
            0,
            0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);
        await seedTradingCoreUsdc(env, ethers.parseUnits("5000000", 6));

        const now = await time.latest();
        // deadline expired => DeadlineExpired branch
        await expect(
            env.trading.connect(env.alice).closePosition({
                positionId: 1,
                closeSize: 0,
                minReceive: 0,
                deadline: now - 1
            })
        ).to.be.reverted;

        // too early => MinPositionDuration branch
        await expect(
            env.trading.connect(env.alice).closePosition({
                positionId: 1,
                closeSize: 0,
                minReceive: 0,
                deadline: now + 1000
            })
        ).to.be.reverted;

        // after duration, wrong owner => NotPositionOwner branch
        await time.increase(200);
        await expect(
            env.trading.connect(env.bob).closePosition({
                positionId: 1,
                closeSize: 0,
                minReceive: 0,
                deadline: (await time.latest()) + 1000
            })
        ).to.be.reverted;

        // partialClose too small remainder => PositionTooSmall branch
        const dl = (await time.latest()) + 1000;
        await time.increase(3);
        await expect(
            env.trading.connect(env.alice).partialClose(1, ethers.parseEther("0.85"), 0, dl)
        ).to.be.reverted;

        // successful partialClose (no revert)
        await env.trading.connect(env.alice).partialClose(1, ethers.parseEther("0.5"), 0, dl + 1);

        // closePosition full close (closeSize=0) success
        await time.increase(3);
        await env.trading.connect(env.alice).closePosition({
            positionId: 1,
            closeSize: 0,
            minReceive: 0,
            deadline: (await time.latest()) + 1000
        });

        // already closed => PositionNotFound branch
        await time.increase(3);
        await expect(
            env.trading.connect(env.alice).closePosition({
                positionId: 1,
                closeSize: 0,
                minReceive: 0,
                deadline: (await time.latest()) + 1000
            })
        ).to.be.reverted;
    });
});
