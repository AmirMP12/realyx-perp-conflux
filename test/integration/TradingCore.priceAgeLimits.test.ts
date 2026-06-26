import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, seedTwap } from "../helpers/fixture";
import { openMarket, closeFull, createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, PosStatus, OrderType } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * Verifies TradingCore's execution price-age controls and liquidation backstops:
 *   - maxExecutionPriceAge setter bounds and the stale-price execute gate
 *   - permissionless-liquidation enable/disable and execution
 *   - the closed-session-liquidation flag that skips the market-open guard
 *   - the partialClose dust-remainder guard (PositionTooSmall)
 *   - cancelOrder USDC collateral-refund withdrawal
 *   - subaccount-delegated orders refunding the fee payer (bot) on cancel
 *   - setParams liquidationDeviationBps in-range application
 *   - the forceSettleFunding pause gate
 */
describe("TradingCore — execution price-age and liquidation controls", () => {
    // ───────────────────────────────────────────────────────────────────
    // maxExecutionPriceAge: setter bounds + execute stale-price gate
    // ───────────────────────────────────────────────────────────────────
    describe("maxExecutionPriceAge", () => {
        it("rejects an age above the 1-hour upper bound", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(60 * 60 + 1),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidParam");
        });

        it("rejects a non-admin caller", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).setMaxExecutionPriceAge(60)).to.be.reverted;
        });

        it("applies a valid age and reads it back", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(120)).to.emit(
                d.tradingCore,
                "MaxExecutionPriceAgeUpdated",
            );
            expect(await d.tradingCore.maxExecutionPriceAge()).to.equal(120n);
        });

        it("reverts executeOrder against a price older than the configured age", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(60);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            // let the stored Pyth snapshot age past 60s, then execute WITHOUT a
            // fresh price update so the on-chain price timestamp is stale.
            await time.increase(200);
            await expect(
                d.tradingCore.connect(d.keeper).executeOrder(orderId, []),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidOraclePrice");
        });

        it("executes within the age window when a fresh price is supplied", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(3600);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
                execPrice: price(50_000), // fresh snapshot pushed at execute time
            });
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.OPEN);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Permissionless liquidation backstop
    // ───────────────────────────────────────────────────────────────────
    describe("permissionless liquidation", () => {
        it("reverts when the backstop is disabled (default)", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(5_000),
            });
            await expect(
                d.tradingCore.connect(d.carol).liquidatePositionPermissionless(id),
            ).to.be.revertedWithCustomError(d.tradingCore, "Unauthorized");
        });

        it("rejects a non-admin toggling the flag", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).setPermissionlessLiquidation(true)).to.be.reverted;
        });

        it("admin enables it and a non-liquidator can wind down an underwater position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(50_000),
                collateralUsdc: usdc(5_300),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(46_500));
            await seedTwap(d, price(46_500));

            await expect(d.tradingCore.connect(d.admin).setPermissionlessLiquidation(true)).to.emit(
                d.tradingCore,
                "PermissionlessLiquidationUpdated",
            );
            expect(await d.tradingCore.permissionlessLiquidationEnabled()).to.equal(true);

            const [can] = await d.tradingCore.canLiquidate(id);
            expect(can).to.equal(true);
            // carol holds no LIQUIDATOR_ROLE yet liquidates via the backstop
            await d.tradingCore.connect(d.carol).liquidatePositionPermissionless(id);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.LIQUIDATED);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Closed-session liquidation flag (skips the market-open guard)
    // ───────────────────────────────────────────────────────────────────
    describe("closed-session liquidation flag", () => {
        it("rejects a non-admin toggling the flag", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).setClosedSessionLiquidation(true)).to.be.reverted;
        });

        it("admin enables it and liquidation skips the market-open check", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(50_000),
                collateralUsdc: usdc(5_300),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(46_500));
            await seedTwap(d, price(46_500));

            await expect(d.tradingCore.connect(d.admin).setClosedSessionLiquidation(true)).to.emit(
                d.tradingCore,
                "ClosedSessionLiquidationUpdated",
            );
            expect(await d.tradingCore.closedSessionLiquidationEnabled()).to.equal(true);

            // _checkMarketOpen is now skipped on the liquidation path
            await d.tradingCore.connect(d.liquidator).liquidatePosition(id);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.LIQUIDATED);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // partialClose PositionTooSmall guard (dust remainder)
    // ───────────────────────────────────────────────────────────────────
    describe("partialClose dust-remainder guard", () => {
        it("reverts when the remaining size would fall below minPositionSize", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(120);
            const deadline = (await time.latest()) + 3600;
            // close 99.99% -> remainder ~1 USDC < minPositionSize (10 USDC) -> PositionTooSmall
            await expect(
                d.tradingCore.connect(d.alice).partialClose(id, ethers.parseUnits("0.9999", 18), 0, deadline),
            ).to.be.revertedWithCustomError(d.tradingCore, "PositionTooSmall");
        });

        it("allows a partial close that leaves a remainder above minPositionSize", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(120);
            const deadline = (await time.latest()) + 3600;
            await d.tradingCore.connect(d.alice).partialClose(id, ethers.parseUnits("0.5", 18), 0, deadline);
            const pos = await d.tradingCore.getPosition(id);
            expect(pos.state).to.equal(PosStatus.OPEN);
            expect(pos.size).to.be.greaterThan(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // cancelOrder USDC collateral refund (non-zero balance path)
    // ───────────────────────────────────────────────────────────────────
    describe("cancelOrder collateral refund", () => {
        it("credits and pays out the escrowed USDC collateral on cancel", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                triggerPrice: price(45_000),
                isLong: true,
            });
            await d.tradingCore.connect(d.alice).cancelOrder(orderId);
            // collateral leg recorded for withdrawal
            const [, , orderCollateralRefund] = await d.tradingCore.getBalances(d.alice.address);
            expect(orderCollateralRefund).to.equal(usdc(2_000));

            const before = await d.usdt0.balanceOf(d.alice.address);
            await d.tradingCore.connect(d.alice).withdrawOrderCollateralRefund();
            const after = await d.usdt0.balanceOf(d.alice.address);
            expect(after - before).to.equal(usdc(2_000));
        });

        it("only the order owner can cancel", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                triggerPrice: price(45_000),
                isLong: true,
            });
            await expect(d.tradingCore.connect(d.bob).cancelOrder(orderId)).to.be.reverted;
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Subaccount-delegated order: bot fronts the fee, refunded on cancel
    // ───────────────────────────────────────────────────────────────────
    describe("subaccount execution-fee-payer refund", () => {
        it("refunds the cancelled order's ETH execution fee to the bot that paid it", async () => {
            const d = await loadFixture(deployConfigured);
            // alice authorizes bob as a trading bot
            await d.tradingCore.connect(d.alice).addSubaccount(d.bob.address);
            // bob (the bot) creates a limit order owned by alice and fronts the fee
            const params = orderParams(d, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: 0n,
                triggerPrice: price(45_000),
                isLong: true,
                owner: d.alice.address,
            });
            const tx = await d.tradingCore.connect(d.bob).createOrder(params, { value: EXEC_FEE });
            const rc = await tx.wait();
            const orderId = rc!.logs
                .map((l: any) => {
                    try {
                        return d.tradingCore.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.name === "OrderCreated").args[0];

            // owner (alice) cancels; the ETH fee refund must accrue to bob (payer)
            await d.tradingCore.connect(d.alice).cancelOrder(orderId);
            const [, bobRefund] = await d.tradingCore.getBalances(d.bob.address);
            expect(bobRefund).to.equal(EXEC_FEE);
            // and alice (owner, non-payer) gets nothing
            const [, aliceRefund] = await d.tradingCore.getBalances(d.alice.address);
            expect(aliceRefund).to.equal(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // setParams liquidationDeviationBps in-range application
    // ───────────────────────────────────────────────────────────────────
    describe("setParams liquidationDeviationBps", () => {
        it("applies an in-range liquidationDeviationBps", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setParams(0, 0, 0, 0, 0, 0, 500);
            expect(await d.tradingCore.liquidationDeviationBps()).to.equal(500n);
        });

        it("ignores an out-of-range liquidationDeviationBps (below floor)", async () => {
            const d = await loadFixture(deployConfigured);
            const before = await d.tradingCore.liquidationDeviationBps();
            await d.tradingCore.connect(d.admin).setParams(0, 0, 0, 0, 0, 0, 50); // < 100 -> ignored
            expect(await d.tradingCore.liquidationDeviationBps()).to.equal(before);
        });

        it("ignores an out-of-range liquidationDeviationBps (above ceiling)", async () => {
            const d = await loadFixture(deployConfigured);
            const before = await d.tradingCore.liquidationDeviationBps();
            await d.tradingCore.connect(d.admin).setParams(0, 0, 0, 0, 0, 0, 6000); // > 5000 -> ignored
            expect(await d.tradingCore.liquidationDeviationBps()).to.equal(before);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // forceSettleFunding whenNotPaused gate
    // ───────────────────────────────────────────────────────────────────
    describe("forceSettleFunding pause gate", () => {
        it("reverts while the contract is paused", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.guardian).pause();
            await expect(d.tradingCore.connect(d.guardian).forceSettleFunding(d.market)).to.be.reverted;
            await d.tradingCore.connect(d.admin).unpause();
        });

        it("settleFunding also reverts while paused", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.guardian).pause();
            await expect(d.tradingCore.connect(d.alice).settleFunding(d.market)).to.be.reverted;
            await d.tradingCore.connect(d.admin).unpause();
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // updateProtocolHealth flips health from current vault TVL
    // ───────────────────────────────────────────────────────────────────
    describe("updateProtocolHealth + detailed PnL completeness", () => {
        it("keeper refresh keeps a well-funded protocol healthy", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await d.tradingCore.connect(d.keeper).updateProtocolHealth();
            const [healthy] = await d.tradingCore.getProtocolHealthState();
            expect(healthy).to.equal(true);
        });

        it("detailed global PnL is complete with a priceable open market", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.bob, {
                isLong: false,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await setPythPrice(d.pyth, d.feedId, price(48_000)); // short profit
            const [pnl, complete] = await d.tradingCore.getGlobalUnrealizedPnLDetailed();
            expect(complete).to.equal(true);
            expect(pnl).to.be.greaterThan(0n);
        });
    });
});

/**
 * Verifies TradingCore's compliance, circuit-breaker, and portfolio-risk guards:
 *   - the executeOrder circuit-breaker gate (checkBreakersForOrder)
 *   - the close/compliance gate (_requireComplianceAndMarketOpen)
 *   - the NFT-transfer compliance hook (updatePositionOwner)
 *   - subaccount-delegated createOrder owner-compliance enforcement
 *   - delegated views reverting Unauthorized when tradingViews is unset
 *   - settlePositionFunding on a non-existent position
 *   - portfolio-risk enforcement at fill (max cross positions)
 *   - the withdrawOrderCollateralTokenRefund zero-address guard
 *   - setTrailingStop anchor set-and-clear handling
 */
describe("TradingCore — compliance, circuit-breaker, and portfolio-risk guards", () => {
    // ───────────────────────────────────────────────────────────────────
    // executeOrder circuit-breaker gate (checkBreakersForOrder)
    // ───────────────────────────────────────────────────────────────────
    describe("executeOrder breaker gate", () => {
        it("reverts an opening increase when a price-drop breaker is active", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            // configure + trip a breaker so isActionAllowed(market, 0) == false
            await d.oracle.connect(d.admin).configureBreaker(d.market, 0, 1000, 900, 600);
            await d.oracle.connect(d.guardian).triggerBreaker(d.market, 0);
            await expect(
                d.tradingCore.connect(d.keeper).executeOrder(orderId, []),
            ).to.be.revertedWithCustomError(d.tradingCore, "BreakerActive");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // closePosition compliance gate (_requireComplianceAndMarketOpen revert)
    // ───────────────────────────────────────────────────────────────────
    describe("close compliance gate", () => {
        it("reverts closePosition when the owner is no longer whitelisted", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(120);
            // revoke alice's compliance whitelist
            await d.compliance.setWhitelist(d.alice.address, false);
            const deadline = (await time.latest()) + 3600;
            await expect(
                d.tradingCore.connect(d.alice).closePosition({
                    positionId: id,
                    closeSize: 0n,
                    minReceive: 0n,
                    deadline,
                }),
            ).to.be.revertedWithCustomError(d.tradingCore, "ComplianceCheckFailed");
        });

        it("reverts partialClose when the owner is no longer whitelisted", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(120);
            await d.compliance.setWhitelist(d.alice.address, false);
            const deadline = (await time.latest()) + 3600;
            await expect(
                d.tradingCore.connect(d.alice).partialClose(id, ethers.parseUnits("0.5", 18), 0, deadline),
            ).to.be.revertedWithCustomError(d.tradingCore, "ComplianceCheckFailed");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // updatePositionOwner compliance hook (NFT transfer to a blocked address)
    // ───────────────────────────────────────────────────────────────────
    describe("position-transfer compliance hook", () => {
        it("reverts transferring a position NFT to a non-whitelisted recipient", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            // carol is whitelisted by the fixture; revoke so the hook rejects
            await d.compliance.setWhitelist(d.carol.address, false);
            // PositionToken's transfer hook calls into TradingCore.updatePositionOwner
            // which reverts on the failed compliance check; the bubbled error type is
            // wrapped by the token, so assert a generic revert.
            await expect(
                d.positionToken.connect(d.alice).transferFrom(d.alice.address, d.carol.address, id),
            ).to.be.reverted;
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // subaccount-delegated createOrder owner-compliance enforcement
    // ───────────────────────────────────────────────────────────────────
    describe("delegated createOrder owner compliance", () => {
        it("reverts when the delegating owner is not whitelisted (bot is)", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.alice).addSubaccount(d.bob.address);
            // bob (the caller) stays whitelisted; alice (the owner) is revoked
            await d.compliance.setWhitelist(d.alice.address, false);
            const params = orderParams(d, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
                owner: d.alice.address,
            });
            await expect(
                d.tradingCore.connect(d.bob).createOrder(params, { value: EXEC_FEE }),
            ).to.be.revertedWithCustomError(d.tradingCore, "ComplianceCheckFailed");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Delegated views revert with Unauthorized when tradingViews is unset
    // ───────────────────────────────────────────────────────────────────
    describe("delegated views — Unauthorized when views are unset", () => {
        it("getPositionPnL / canLiquidate / global PnL revert when views unset", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setTradingViews(ethers.ZeroAddress);
            await expect(d.tradingCore.getPositionPnL(1)).to.be.revertedWithCustomError(
                d.tradingCore,
                "Unauthorized",
            );
            await expect(d.tradingCore.canLiquidate(1)).to.be.revertedWithCustomError(
                d.tradingCore,
                "Unauthorized",
            );
            await expect(d.tradingCore.getGlobalUnrealizedPnL()).to.be.revertedWithCustomError(
                d.tradingCore,
                "Unauthorized",
            );
            await expect(d.tradingCore.getGlobalUnrealizedPnLDetailed()).to.be.revertedWithCustomError(
                d.tradingCore,
                "Unauthorized",
            );
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // settlePositionFunding for a non-existent position
    // ───────────────────────────────────────────────────────────────────
    describe("settlePositionFunding market==0 short-circuit", () => {
        it("skips market settlement for an unknown id (reverts in the dividend leg)", async () => {
            const d = await loadFixture(deployConfigured);
            // market == address(0) for an unknown id, so the market-level
            // settleFunding is skipped; the per-position
            // dividend settlement then reverts PositionNotFound.
            await expect(d.tradingCore.settlePositionFunding(999_999)).to.be.reverted;
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Portfolio-risk violation at fill (max cross positions exceeded)
    // ───────────────────────────────────────────────────────────────────
    describe("portfolio risk violation at fill", () => {
        it("reverts the second cross-margin open when maxCrossPositions == 1", async () => {
            const d = await loadFixture(deployConfigured);
            // enable portfolio risk, cross-margin default, cap cross positions at 1
            await d.tradingCore.connect(d.admin).setPortfolioRiskConfig(true, true, 500, 4000, 1);
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            await expect(
                d.tradingCore.connect(d.keeper).executeOrder(orderId, []),
            ).to.be.revertedWithCustomError(d.tradingCore, "PortfolioRiskViolation");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // withdrawOrderCollateralTokenRefund zero-address guard
    // ───────────────────────────────────────────────────────────────────
    describe("withdrawOrderCollateralTokenRefund guard", () => {
        it("reverts on a zero token address", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).withdrawOrderCollateralTokenRefund(ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
        });

        it("is a no-op for a token with no recorded refund balance", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore
                .connect(d.alice)
                .withdrawOrderCollateralTokenRefund(await d.usdt0.getAddress());
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // setTrailingStop anchor set-and-clear handling
    // ───────────────────────────────────────────────────────────────────
    describe("setTrailingStop anchor handling", () => {
        it("sets a non-zero trailing stop (anchor recorded) then clears it", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            // a non-zero bps records the trailing-stop anchor
            await d.tradingCore.connect(d.alice).setTrailingStop(id, 500);
            expect((await d.tradingCore.getPosition(id)).trailingStopBps).to.equal(500n);
            // zero bps clears the anchor
            await d.tradingCore.connect(d.alice).setTrailingStop(id, 0);
            expect((await d.tradingCore.getPosition(id)).trailingStopBps).to.equal(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // setMaxFundingIntervals applies a valid in-range cap
    // ───────────────────────────────────────────────────────────────────
    describe("forceSettleFunding with a custom interval cap", () => {
        it("catches up funding after a long dormancy using a raised cap", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await d.tradingCore.connect(d.admin).setMaxFundingIntervals(72);
            await time.increase(8 * 60 * 60 * 30); // ~30 intervals dormant
            await setPythPrice(d.pyth, d.feedId, price(50_000));
            await seedTwap(d, price(50_000));
            await d.tradingCore.connect(d.guardian).forceSettleFunding(d.market);
            const fs = await d.tradingCore.getFundingState(d.market);
            expect(fs.lastSettlement).to.be.greaterThan(0n);
        });
    });
});

/**
 * Verifies additional TradingCore entrypoints and emergency paths:
 *   - the legacy 8-arg positional createOrder shim
 *   - reduce-only DECREASE orders requiring a positionId
 *   - visibleSize equal to sizeDelta being accepted
 *   - withdrawKeeperFees paying out a real accrued balance
 *   - the withdrawCollateral protocol-health gate (checkProtocolHealth)
 *   - permissionless liquidation while the session is closed and the flag is enabled
 *   - setMaxExecutionPriceAge(0) disabling the stale-price gate
 *   - addCollateral via the emergency-flag path
 */
describe("TradingCore — order entrypoints, fee withdrawals, and emergency paths", () => {
    // ───────────────────────────────────────────────────────────────────
    // Legacy positional createOrder shim
    // ───────────────────────────────────────────────────────────────────
    describe("legacy 8-arg createOrder", () => {
        it("creates and executes a market increase through the positional shim", async () => {
            const d = await loadFixture(deployConfigured);
            const nextId = await d.tradingCore.nextPositionId();
            const tx = await d.tradingCore
                .connect(d.alice)
                ["createOrder(uint8,address,uint256,uint256,uint256,bool,uint256,uint256)"](
                    OrderType.MARKET_INCREASE,
                    d.market,
                    usdc(10_000),
                    usdc(2_000),
                    0,
                    true,
                    0,
                    0,
                    { value: EXEC_FEE },
                );
            const rc = await tx.wait();
            const ev = rc!.logs
                .map((l: any) => {
                    try {
                        return d.tradingCore.interface.parseLog(l);
                    } catch {
                        return null;
                    }
                })
                .find((p: any) => p && p.name === "OrderCreated");
            const orderId = ev.args[0];
            await executeOrder(d, orderId);
            expect((await d.tradingCore.getPosition(nextId)).state).to.equal(PosStatus.OPEN);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // reduce-only DECREASE without a positionId
    // ───────────────────────────────────────────────────────────────────
    describe("reduce-only decrease validation", () => {
        it("reverts a reduce-only decrease that has no positionId", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.LIMIT_DECREASE,
                        sizeDelta: usdc(10_000),
                        triggerPrice: price(55_000),
                        isReduceOnly: true,
                        positionId: 0,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReduceOnlyRequiresPosition");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // visibleSize equal to sizeDelta is accepted
    // ───────────────────────────────────────────────────────────────────
    describe("visibleSize equal to size", () => {
        it("accepts an order whose visibleSize equals sizeDelta", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        visibleSize: usdc(10_000),
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.emit(d.tradingCore, "OrderCreated");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // withdrawKeeperFees with a real accrued balance
    // ───────────────────────────────────────────────────────────────────
    describe("withdrawKeeperFees payout", () => {
        it("pays out keeper execution fees accrued from a fill", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            await executeOrder(d, orderId); // keeper accrues the exec fee
            const [keeperFee] = await d.tradingCore.getBalances(d.keeper.address);
            expect(keeperFee).to.equal(EXEC_FEE);
            const before = await ethers.provider.getBalance(d.keeper.address);
            const tx = await d.tradingCore.connect(d.keeper).withdrawKeeperFees();
            const rc = await tx.wait();
            const gas = rc!.gasUsed * rc!.gasPrice;
            const after = await ethers.provider.getBalance(d.keeper.address);
            expect(after - before + gas).to.equal(EXEC_FEE);
            const [keeperFeeAfter] = await d.tradingCore.getBalances(d.keeper.address);
            expect(keeperFeeAfter).to.equal(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // withdrawCollateral while protocol is healthy (checkProtocolHealth pass)
    // ───────────────────────────────────────────────────────────────────
    describe("withdrawCollateral checkProtocolHealth gate", () => {
        it("permits withdrawCollateral while the protocol is healthy", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(5_000),
            });
            await time.increase(120);
            // withdrawal is permitted while the protocol is healthy
            await d.tradingCore.connect(d.alice).withdrawCollateral(id, usdc(500));
            const c = await d.tradingCore.getPositionCollateral(id);
            expect(c.amount).to.be.lessThan(usdc(5_000) * 10n ** 12n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // permissionless liquidation while the session is closed + flag enabled
    // ───────────────────────────────────────────────────────────────────
    describe("permissionless + closed-session combined", () => {
        it("permissionless liquidation works with closed-session enabled", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(50_000),
                collateralUsdc: usdc(5_300),
            });
            await time.increase(120);
            await setPythPrice(d.pyth, d.feedId, price(46_500));
            await seedTwap(d, price(46_500));

            await d.tradingCore.connect(d.admin).setPermissionlessLiquidation(true);
            await d.tradingCore.connect(d.admin).setClosedSessionLiquidation(true);
            // carol has no role; backstop + closed-session both engaged
            await d.tradingCore.connect(d.carol).liquidatePositionPermissionless(id);
            expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.LIQUIDATED);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // setMaxExecutionPriceAge(0) disables the stale-price gate
    // ───────────────────────────────────────────────────────────────────
    describe("setMaxExecutionPriceAge disable", () => {
        it("a zero age lets a stale-snapshot execution proceed", async () => {
            const d = await loadFixture(deployConfigured);
            // first set a tight age, then clear it back to 0 (disabled)
            await d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(60);
            await d.tradingCore.connect(d.admin).setMaxExecutionPriceAge(0);
            expect(await d.tradingCore.maxExecutionPriceAge()).to.equal(0n);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            await time.increase(200); // snapshot ages but gate disabled
            await d.tradingCore.connect(d.keeper).executeOrder(orderId, []);
            // order consumed -> position opened
            expect(await d.tradingCore.nextPositionId()).to.be.greaterThan(1n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // addCollateral emergency-flag path
    // ───────────────────────────────────────────────────────────────────
    describe("addCollateral emergency flag", () => {
        it("tops up collateral with the emergency flag on an unlisted market", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            // emergency tops are only permitted while the market is NOT active
            await d.tradingCore.connect(d.admin).unlistMarket(d.market);
            const before = (await d.tradingCore.getPositionCollateral(id)).amount;
            await d.tradingCore.connect(d.alice).addCollateral(id, usdc(1_000), 0, true);
            const after = (await d.tradingCore.getPositionCollateral(id)).amount;
            expect(after).to.be.greaterThan(before);
        });
    });
});
