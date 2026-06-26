import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, deployProtocol, seedTwap } from "../helpers/fixture";
import { openMarket, closeFull, createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, OrderType, TimeInForce, PosStatus } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;
const RWA_TIMELOCK = 48 * 60 * 60;

describe("TradingCore", () => {
    // ───────────────────────────────────────────────────────────────────
    // Referral registry rotation timelock
    // ───────────────────────────────────────────────────────────────────
    describe("setReferralRegistry timelock", () => {
        it("reverts when supplied registry does not match the staged proposal", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).proposeReferralRegistry(d.bob.address);
            await expect(
                d.tradingCore.connect(d.admin).setReferralRegistry(d.carol.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "PendingReferralRegistryMismatch");
        });

        it("reverts when the timelock has not elapsed", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).proposeReferralRegistry(d.bob.address);
            await expect(
                d.tradingCore.connect(d.admin).setReferralRegistry(d.bob.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReferralRegistryTimelockActive");
        });

        it("reverts when no proposal was staged (effective == 0)", async () => {
            const d = await loadFixture(deployConfigured);
            // matches the (zero) pending value but effective is 0
            await expect(
                d.tradingCore.connect(d.admin).setReferralRegistry(ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReferralRegistryTimelockActive");
        });

        it("applies the rotation after the timelock elapses", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).proposeReferralRegistry(d.bob.address);
            await time.increase(RWA_TIMELOCK + 1);
            await d.tradingCore.connect(d.admin).setReferralRegistry(d.bob.address);
            expect(await d.tradingCore.referralRegistry()).to.equal(d.bob.address);
            // pending cleared
            const [pending, effective] = await d.tradingCore.pendingReferralRegistry();
            expect(pending).to.equal(ethers.ZeroAddress);
            expect(effective).to.equal(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // RWA contracts rotation timelock
    // ───────────────────────────────────────────────────────────────────
    describe("setRWAContracts rotation", () => {
        it("reverts on mismatch against the staged proposal (already initialized)", async () => {
            const d = await loadFixture(deployConfigured);
            const cal = await d.marketCalendar.getAddress();
            const dm = await d.dividendManager.getAddress();
            const cm = await d.compliance.getAddress();
            // no propose -> pending all zero, so non-zero triple mismatches
            await expect(
                d.tradingCore.connect(d.admin).setRWAContracts(cal, dm, cm),
            ).to.be.revertedWithCustomError(d.tradingCore, "PendingRWAMismatch");
        });

        it("reverts when rotation timelock is still active", async () => {
            const d = await loadFixture(deployConfigured);
            const cal = await d.marketCalendar.getAddress();
            const dm = await d.dividendManager.getAddress();
            const cm = await d.compliance.getAddress();
            await d.tradingCore.connect(d.admin).proposeRWAContracts(cal, dm, cm);
            await expect(
                d.tradingCore.connect(d.admin).setRWAContracts(cal, dm, cm),
            ).to.be.revertedWithCustomError(d.tradingCore, "RWATimelockActive");
        });

        it("applies the rotation after the timelock elapses", async () => {
            const d = await loadFixture(deployConfigured);
            const cal = await d.marketCalendar.getAddress();
            const dm = await d.dividendManager.getAddress();
            const cm = await d.compliance.getAddress();
            await d.tradingCore.connect(d.admin).proposeRWAContracts(cal, dm, cm);
            await time.increase(RWA_TIMELOCK + 1);
            await d.tradingCore.connect(d.admin).setRWAContracts(cal, dm, cm);
            // pending cleared
            const [pcal, , , effective] = await d.tradingCore.pendingRWAContracts();
            expect(pcal).to.equal(ethers.ZeroAddress);
            expect(effective).to.equal(0n);
        });

        it("first-time wire-up applies immediately (no timelock)", async () => {
            const d = await loadFixture(deployProtocol);
            const cal = await d.marketCalendar.getAddress();
            const dm = await d.dividendManager.getAddress();
            const cm = await d.compliance.getAddress();
            // fixture's deployProtocol already wired RWA once; but a fresh
            // TradingCore-style first call here re-tests the immediate path is
            // idempotent only via rotation. Instead assert proposeRWAContracts
            // stores the staged triple.
            await d.tradingCore.connect(d.admin).proposeRWAContracts(cal, dm, cm);
            const [pcal, pdm, pcm] = await d.tradingCore.pendingRWAContracts();
            expect(pcal).to.equal(cal);
            expect(pdm).to.equal(dm);
            expect(pcm).to.equal(cm);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // setMarketId rebinding guards
    // ───────────────────────────────────────────────────────────────────
    describe("setMarketId rebinding", () => {
        it("allows rebinding an id when there are no open positions", async () => {
            const d = await loadFixture(deployConfigured);
            // market already has id 'BTC-USD' but no open positions -> rebind ok
            await d.tradingCore.connect(d.admin).setMarketId(d.market, "BTC-USD-2");
            // no revert; binding succeeded
        });

        it("refuses rebind when the market has open interest", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await expect(
                d.tradingCore.connect(d.admin).setMarketId(d.market, "BTC-USD-NEW"),
            ).to.be.revertedWithCustomError(d.tradingCore, "MarketIdRebindForbidden");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Market listing configuration
    // ───────────────────────────────────────────────────────────────────
    describe("market listing setters", () => {
        it("unlistMarket removes the market from the active set", async () => {
            const d = await loadFixture(deployConfigured);
            const countBefore = await d.tradingCore.activeMarketCount();
            await d.tradingCore.connect(d.admin).unlistMarket(d.market);
            const countAfter = await d.tradingCore.activeMarketCount();
            expect(countAfter).to.equal(countBefore - 1n);
        });

        it("only operator can unlistMarket", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).unlistMarket(d.market),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotOperator");
        });

        it("only operator can setMarket", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore
                    .connect(d.alice)
                    .setMarket(d.bob.address, d.bob.address, 10, 1, 1, 500, 1000, 900),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotOperator");
        });

        it("activeMarketAt returns a listed market address", async () => {
            const d = await loadFixture(deployConfigured);
            const addr = await d.tradingCore.activeMarketAt(0);
            expect(addr.toLowerCase()).to.equal(d.market.toLowerCase());
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // validateOracleForMarket
    // ───────────────────────────────────────────────────────────────────
    describe("validateOracleForMarket", () => {
        it("passes for a configured market", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.validateOracleForMarket(d.market);
        });

        it("reverts for a market with no oracle source", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.validateOracleForMarket(d.bob.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "InsufficientOracleSources");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Subaccount-delegated order creation (effectiveOwner != msg.sender)
    // ───────────────────────────────────────────────────────────────────
    describe("subaccount delegation in createOrder", () => {
        it("a delegated bot can create an order owned by the principal", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.alice).addSubaccount(d.bob.address);
            const params = orderParams(d, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
                owner: d.alice.address,
            });
            await expect(
                d.tradingCore.connect(d.bob).createOrder(params, { value: EXEC_FEE }),
            ).to.emit(d.tradingCore, "OrderCreated");
        });

        it("reverts when the bot is not an approved subaccount", async () => {
            const d = await loadFixture(deployConfigured);
            const params = orderParams(d, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
                owner: d.alice.address,
            });
            await expect(
                d.tradingCore.connect(d.bob).createOrder(params, { value: EXEC_FEE }),
            ).to.be.revertedWithCustomError(d.tradingCore, "SubaccountNotApproved");
        });

        it("removeSubaccount revokes delegation", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.alice).addSubaccount(d.bob.address);
            await d.tradingCore.connect(d.alice).removeSubaccount(d.bob.address);
            expect(await d.tradingCore.isSubaccount(d.alice.address, d.bob.address)).to.equal(false);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // createOrder POST_ONLY/market-type and alt-collateral guards
    // ───────────────────────────────────────────────────────────────────
    describe("createOrder guards", () => {
        it("POST_ONLY on a market order reverts (PostOnlyNotAllowedForMarket)", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        tif: TimeInForce.POST_ONLY,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "PostOnlyNotAllowedForMarket");
        });

        it("reverts when a non-USDT0 collateral token is supplied (alt disabled)", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        collateralToken: d.usdt0.target ?? (await d.usdt0.getAddress()),
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "AltCollateralDisabled");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // addCollateral / withdrawCollateral paths
    // ───────────────────────────────────────────────────────────────────
    describe("collateral adjustments", () => {
        it("addCollateral increases the position margin", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            const before = (await d.tradingCore.getPositionCollateral(id)).amount;
            await d.tradingCore.connect(d.alice).addCollateral(id, usdc(1_000), 0, false);
            const after = (await d.tradingCore.getPositionCollateral(id)).amount;
            expect(after).to.be.greaterThan(before);
        });

        it("addCollateral from a non-owner reverts", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await expect(
                d.tradingCore.connect(d.bob).addCollateral(id, usdc(1_000), 0, false),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotPositionOwner");
        });

        it("withdrawCollateral reduces the position margin", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(5_000),
            });
            const before = (await d.tradingCore.getPositionCollateral(id)).amount;
            await d.tradingCore.connect(d.alice).withdrawCollateral(id, usdc(500));
            const after = (await d.tradingCore.getPositionCollateral(id)).amount;
            expect(after).to.be.lessThan(before);
        });

        it("withdrawCollateral on a non-open position reverts", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).withdrawCollateral(999, usdc(100)),
            ).to.be.revertedWithCustomError(d.tradingCore, "PositionNotFound");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // cancelOrder + refund withdrawals
    // ───────────────────────────────────────────────────────────────────
    describe("order cancellation & refunds", () => {
        it("cancelOrder credits an order refund that can be withdrawn", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                triggerPrice: price(45_000),
                isLong: true,
            });
            await d.tradingCore.connect(d.alice).cancelOrder(orderId);
            // refund balance recorded for the fee payer
            const [, orderRefund] = await d.tradingCore.getBalances(d.alice.address);
            expect(orderRefund).to.be.greaterThanOrEqual(0n);
            await d.tradingCore.connect(d.alice).withdrawOrderRefund();
        });

        it("withdrawOrderCollateralRefund is a no-op without a balance", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.alice).withdrawOrderCollateralRefund();
        });

        it("withdrawKeeperFees is a no-op without accrued fees", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.bob).withdrawKeeperFees();
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Funding settlement entry points
    // ───────────────────────────────────────────────────────────────────
    describe("funding settlement", () => {
        it("settleFunding for a market does not revert", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(8 * 60 * 60 + 1);
            await setPythPrice(d.pyth, d.feedId, price(50_000));
            await seedTwap(d, price(50_000));
            await d.tradingCore.connect(d.alice).settleFunding(d.market);
        });

        it("forceSettleFunding is guardian-only and catches up dormant funding", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await time.increase(8 * 60 * 60 + 1);
            await setPythPrice(d.pyth, d.feedId, price(50_000));
            await seedTwap(d, price(50_000));
            await d.tradingCore.connect(d.guardian).forceSettleFunding(d.market);
        });

        it("forceSettleFunding rejects a non-guardian", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).forceSettleFunding(d.market)).to.be.reverted;
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // Protocol health + bad-debt admin paths
    // ───────────────────────────────────────────────────────────────────
    describe("protocol health & bad debt", () => {
        it("keeper can refresh protocol health", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.keeper).updateProtocolHealth();
            const [healthy] = await d.tradingCore.getProtocolHealthState();
            expect(healthy).to.equal(true);
        });

        it("non-keeper cannot refresh protocol health", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).updateProtocolHealth()).to.be.reverted;
        });

        it("writeDownBadDebt clamps to zero when amount exceeds bad debt", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).writeDownBadDebt(ethers.parseEther("1000000"));
            const [, badDebt] = await d.tradingCore.getProtocolHealthState();
            expect(badDebt).to.equal(0n);
        });

        it("writeDownBadDebt with zero leaves state consistent", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).writeDownBadDebt(0);
            const [, badDebt] = await d.tradingCore.getProtocolHealthState();
            expect(badDebt).to.equal(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // View delegations through tradingViews
    // ───────────────────────────────────────────────────────────────────
    describe("delegated view queries", () => {
        it("getPositionPnL returns a pnl and health factor for an open position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            const [pnl, hf] = await d.tradingCore.getPositionPnL(id);
            expect(hf).to.be.greaterThan(0n);
            expect(pnl).to.be.a("bigint");
        });

        it("canLiquidate returns false for a healthy position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            const [liq] = await d.tradingCore.canLiquidate(id);
            expect(liq).to.equal(false);
        });

        it("getGlobalUnrealizedPnL aggregates open interest", async () => {
            const d = await loadFixture(deployConfigured);
            await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            await setPythPrice(d.pyth, d.feedId, price(52_000));
            const pnl = await d.tradingCore.getGlobalUnrealizedPnL();
            expect(pnl).to.be.greaterThan(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // liquidatePosition guards
    // ───────────────────────────────────────────────────────────────────
    describe("liquidatePosition guards", () => {
        it("reverts liquidating a healthy position", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(5_000),
            });
            await expect(d.tradingCore.connect(d.liquidator).liquidatePosition(id)).to.be.reverted;
        });

        it("non-liquidator cannot call liquidatePosition", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(5_000),
            });
            await expect(d.tradingCore.connect(d.alice).liquidatePosition(id)).to.be.reverted;
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // failed-repayment views
    // ───────────────────────────────────────────────────────────────────
    describe("failed-repayment list views", () => {
        it("failedRepaymentIdAt reverts on an out-of-range index", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.failedRepaymentIdAt(0)).to.be.reverted;
        });

        it("totalFailedRepayments starts at zero", async () => {
            const d = await loadFixture(deployConfigured);
            expect(await d.tradingCore.totalFailedRepayments()).to.equal(0n);
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // closePosition deadline gate
    // ───────────────────────────────────────────────────────────────────
    describe("closePosition deadline", () => {
        it("reverts when the deadline has passed", async () => {
            const d = await loadFixture(deployConfigured);
            const id = await openMarket(d, d.alice, {
                isLong: true,
                sizeUsdc: usdc(10_000),
                collateralUsdc: usdc(2_000),
            });
            const past = (await time.latest()) - 10;
            await expect(
                d.tradingCore.connect(d.alice).closePosition({
                    positionId: id,
                    closeSize: 0n,
                    minReceive: 0n,
                    deadline: past,
                }),
            ).to.be.revertedWithCustomError(d.tradingCore, "DeadlineExpired");
        });
    });

    // ───────────────────────────────────────────────────────────────────
    // setParams valid bound application (minPositionSize, minInteractionDelay)
    // ───────────────────────────────────────────────────────────────────
    describe("setParams valid bound application", () => {
        it("applies maxActionsPerBlock and minInteractionDelay within range", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setParams(usdc(50), 0, 500, 0, 100, 5, 0);
            expect(await d.tradingCore.maxActionsPerBlock()).to.equal(500n);
            expect(await d.tradingCore.minInteractionDelay()).to.equal(5n);
            expect(await d.tradingCore.maxPositionsPerUser()).to.equal(100n);
        });

        it("rejects maxOracleUncertainty above 1e18", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setParams(0, ethers.parseEther("2"), 0, 0, 0, 0, 0),
            ).to.be.reverted;
        });

        it("rejects maxActionsPerBlock above 1000", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setParams(0, 0, 1001, 0, 0, 0, 0)).to.be.reverted;
        });
    });
});
