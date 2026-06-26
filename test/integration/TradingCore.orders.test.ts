import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { createOrder, executeOrder, orderParams, EXEC_FEE } from "../helpers/trading";
import { usdc, OrderType, TimeInForce, CollateralType } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

describe("TradingCore — orders & keeper (integration)", () => {
    describe("createOrder validation", () => {
        it("reverts when execution fee below minimum", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        isLong: true,
                    }),
                    { value: 0 },
                ),
            ).to.be.reverted; // ExecutionFeeTooLow
        });

        it("rejects alt-collateral token", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        collateralToken: d.alice.address,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "AltCollateralDisabled");
        });

        it("rejects non-USDT0 collateral type", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        collateralType: CollateralType.USDC,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "AltCollateralDisabled");
        });

        it("POST_ONLY market order reverts", async () => {
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

        it("reduce-only without a position reverts", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.LIMIT_DECREASE,
                        sizeDelta: usdc(10_000),
                        triggerPrice: price(50_000),
                        isReduceOnly: true,
                        positionId: 0,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReduceOnlyRequiresPosition");
        });

        it("visible size larger than size reverts", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        visibleSize: usdc(20_000),
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidVisibleSize");
        });
    });

    describe("limit orders", () => {
        it("creates and executes a limit increase when price reaches trigger", async () => {
            const d = await loadFixture(deployConfigured);
            // long limit triggers when spot <= trigger; set trigger at 50k (current price)
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                triggerPrice: price(50_000),
                isLong: true,
            });
            await executeOrder(d, orderId, price(49_500));
            const nextId = await d.tradingCore.nextPositionId();
            expect(nextId).to.be.greaterThan(1n);
        });

        it("limit increase reverts if price has not reached trigger", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                triggerPrice: price(45_000),
                isLong: true,
            });
            // spot 50k > trigger 45k for a long -> not fillable
            await expect(executeOrder(d, orderId, price(50_000))).to.be.reverted;
        });
    });

    describe("cancelOrder + refunds", () => {
        it("cancels an order and refunds escrowed collateral", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                triggerPrice: price(45_000),
                isLong: true,
            });
            await d.tradingCore.connect(d.alice).cancelOrder(orderId);
            // collateral refund is credited to a balance; withdraw it
            const before = await d.usdt0.balanceOf(d.alice.address);
            await d.tradingCore.connect(d.alice).withdrawOrderCollateralRefund();
            expect(await d.usdt0.balanceOf(d.alice.address)).to.be.greaterThan(before);
        });

        it("refunds the ETH execution fee on cancel", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.LIMIT_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                triggerPrice: price(45_000),
                isLong: true,
            });
            await d.tradingCore.connect(d.alice).cancelOrder(orderId);
            await expect(d.tradingCore.connect(d.alice).withdrawOrderRefund()).to.not.be.reverted;
        });
    });

    describe("keeper execution access", () => {
        it("only KEEPER_ROLE can execute orders", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            await expect(d.tradingCore.connect(d.alice).executeOrder(orderId, [])).to.be.reverted;
        });

        it("keeper earns execution fees withdrawable later", async () => {
            const d = await loadFixture(deployConfigured);
            const orderId = await createOrder(d, d.alice, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
            });
            await executeOrder(d, orderId);
            const [keeperFee] = await d.tradingCore.getBalances(d.keeper.address);
            expect(keeperFee).to.be.greaterThan(0n);
            await d.tradingCore.connect(d.keeper).withdrawKeeperFees();
        });
    });

    describe("subaccount delegation", () => {
        it("adds and removes a subaccount", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).addSubaccount(d.bob.address)).to.emit(
                d.tradingCore,
                "SubaccountUpdated",
            );
            expect(await d.tradingCore.isSubaccount(d.alice.address, d.bob.address)).to.equal(true);
            await d.tradingCore.connect(d.alice).removeSubaccount(d.bob.address);
            expect(await d.tradingCore.isSubaccount(d.alice.address, d.bob.address)).to.equal(false);
        });

        it("reverts self-delegation", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).addSubaccount(d.alice.address)).to.be.revertedWithCustomError(
                d.tradingCore,
                "InvalidParam",
            );
        });

        it("bot can place an order on behalf of an approved owner", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.alice).addSubaccount(d.bob.address);
            // bob (the bot) creates an order owned by alice; alice's USDC is used at execute
            const orderId = await createOrder(d, d.bob, {
                orderType: OrderType.MARKET_INCREASE,
                sizeDelta: usdc(10_000),
                collateralDelta: usdc(2_000),
                isLong: true,
                owner: d.alice.address,
            });
            await executeOrder(d, orderId);
            // the position should be credited to alice
            const alicesPositions = await d.tradingCore.getUserPositions(d.alice.address);
            expect(alicesPositions.length).to.be.greaterThan(0);
        });

        it("reverts when a non-approved bot delegates", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.bob).createOrder(
                    orderParams(d, {
                        orderType: OrderType.MARKET_INCREASE,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        isLong: true,
                        owner: d.alice.address,
                    }),
                    { value: EXEC_FEE },
                ),
            ).to.be.revertedWithCustomError(d.tradingCore, "SubaccountNotApproved");
        });
    });

    describe("legacy createOrder shim", () => {
        it("accepts the 8-arg positional form", async () => {
            const d = await loadFixture(deployConfigured);
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
            await expect(tx).to.emit(d.tradingCore, "OrderCreated");
        });
    });
});
