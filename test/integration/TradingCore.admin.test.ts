import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployProtocol, deployConfigured } from "../helpers/fixture";
import { usdc, RWA_TIMELOCK } from "../helpers/constants";

describe("TradingCore — admin, config & wiring", () => {
    describe("setContracts", () => {
        it("reverts on zero address", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(
                d.tradingCore.connect(d.admin).setContracts(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress),
            ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
        });
        it("only admin can set contracts", async () => {
            const d = await loadFixture(deployProtocol);
            await expect(
                d.tradingCore.connect(d.alice).setContracts(d.bob.address, d.bob.address, d.bob.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotAdmin");
        });
    });

    describe("market configuration", () => {
        it("only operator can set a market", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.alice).setMarket(d.bob.address, d.bob.address, 10, 1, 1, 500, 1000, 900),
            ).to.be.revertedWithCustomError(d.tradingCore, "NotOperator");
        });
        it("lists and unlists a market", async () => {
            const d = await loadFixture(deployConfigured);
            const m2 = "0x00000000000000000000000000000000000000C8";
            await d.oracle.setPythFeed(m2, d.feedId, 900, 10n ** 15n);
            await d.tradingCore.setMarket(
                m2,
                m2,
                20,
                ethers.parseUnits("100000000", 18),
                ethers.parseUnits("500000000", 18),
                500,
                1000,
                900,
            );
            expect((await d.tradingCore.getMarketInfo(m2)).isListed).to.equal(true);
            await d.tradingCore.unlistMarket(m2);
            expect((await d.tradingCore.getMarketInfo(m2)).isActive).to.equal(false);
        });
        it("tracks active market count and indexing", async () => {
            const d = await loadFixture(deployConfigured);
            expect(await d.tradingCore.activeMarketCount()).to.be.greaterThan(0n);
            expect(await d.tradingCore.activeMarketAt(0)).to.equal(ethers.getAddress(d.market));
        });

        it("supports configuring up to 100x and opening a high-leverage position", async () => {
            const d = await loadFixture(deployConfigured);
            const m3 = ethers.getAddress("0x00000000000000000000000000000000000000de");
            const mId = "HILEV-USD";
            const price = 50_000n * 10n ** 18n;
            // Wire a fresh 24x7 market with a 100x cap and a 1% initial-margin
            // floor (imBps=100 → 100x), maintenance 50 bps.
            await d.oracle.setPythFeed(m3, d.feedId, 900, 10n ** 15n);
            await d.oracle.addSupportedMarket(m3);
            await d.oracle.setMarketId(m3, mId);
            await d.marketCalendar.setMarketConfig(mId, 0, 1439, 0, true);
            await d.tradingCore.setMarket(
                m3,
                m3,
                100, // maxLev = 100x (previously impossible to use past ~18x)
                ethers.parseUnits("100000000", 18),
                ethers.parseUnits("500000000", 18),
                50, // mmBps
                100, // imBps -> 100x reachable
                900,
            );
            await d.tradingCore.setMarketId(m3, mId);
            // Seed TWAP for the new market.
            const { setPythPrice } = await import("../helpers/pyth");
            for (let i = 0; i < 4; i++) {
                await setPythPrice(d.pyth, d.feedId, price);
                await d.oracle.connect(d.oracleBot).recordPricePoint(m3, 0);
                await time.increase(35);
            }
            await setPythPrice(d.pyth, d.feedId, price);

            // Open ~95x on the new market WITHOUT mutating the shared fixture
            // object (`loadFixture` returns the same `d` reference across tests,
            // so mutating `d.market` would leak into later tests). Build the
            // order with an explicit `market` override instead.
            const { createOrder, executeOrder } = await import("../helpers/trading");
            const nextId = await d.tradingCore.nextPositionId();
            const orderId = await createOrder(d, d.alice, {
                market: m3,
                sizeDelta: usdc(100_000),
                collateralDelta: usdc(1_100),
                isLong: true,
            });
            await executeOrder(d, orderId);
            const id = nextId;
            const pos = await d.tradingCore.getPosition(id);
            // Stored leverage is ~95e18 — proving the uint128 widening removed
            // the prior ~18.44x truncation ceiling.
            expect(pos.leverage).to.be.greaterThan(90n * 10n ** 18n);
            // Freshly opened high-leverage position is NOT liquidatable at entry.
            const [can] = await d.tradingCore.canLiquidate(id);
            expect(can).to.equal(false);
        });

        it("rejects configuring leverage above the 100x hard ceiling", async () => {
            const d = await loadFixture(deployConfigured);
            const m4 = ethers.getAddress("0x00000000000000000000000000000000000000ef");
            await d.oracle.setPythFeed(m4, d.feedId, 900, 10n ** 15n);
            await expect(
                d.tradingCore.setMarket(
                    m4,
                    m4,
                    101, // > MAX_LEVERAGE_LIMIT
                    ethers.parseUnits("100000000", 18),
                    ethers.parseUnits("500000000", 18),
                    50,
                    100,
                    900,
                ),
            ).to.be.reverted;
        });
    });

    describe("setFeeConfig", () => {
        it("rejects an invalid fee config", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setFeeConfig({
                    makerFeeBps: 5,
                    takerFeeBps: 2, // taker < maker -> invalid
                    minFeeUsdc: 0,
                    lpShareBps: 7000,
                    insuranceShareBps: 2000,
                    treasuryShareBps: 1000,
                }),
            ).to.be.reverted;
        });
        it("applies a valid fee config", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setFeeConfig({
                    makerFeeBps: 1,
                    takerFeeBps: 4,
                    minFeeUsdc: 100000,
                    lpShareBps: 7000,
                    insuranceShareBps: 2000,
                    treasuryShareBps: 1000,
                }),
            ).to.emit(d.tradingCore, "FeeConfigUpdated");
        });
    });

    describe("setParams / setLimits bounds", () => {
        it("setParams rejects maxOracleUncertainty over 1e18", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setParams(0, ethers.parseUnits("2", 18), 0, 0, 0, 0, 0),
            ).to.be.reverted;
        });
        it("setParams rejects maxActionsPerBlock over 1000", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setParams(0, 0, 1001, 0, 0, 0, 0)).to.be.reverted;
        });
        it("setLimits rejects global < user volume limit", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setLimits(usdc(1_000_000), usdc(500_000), 0, 0, 0, 0),
            ).to.be.reverted;
        });
        it("setMaxFundingIntervals bounds [1,72]", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setMaxFundingIntervals(0)).to.be.revertedWithCustomError(
                d.tradingCore,
                "InvalidParam",
            );
            await expect(d.tradingCore.connect(d.admin).setMaxFundingIntervals(73)).to.be.revertedWithCustomError(
                d.tradingCore,
                "InvalidParam",
            );
            await d.tradingCore.connect(d.admin).setMaxFundingIntervals(48);
            expect(await d.tradingCore.maxFundingIntervals()).to.equal(48n);
        });
        it("setMinLiquidatorRewardUsdc bounds", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setMinLiquidatorRewardUsdc(usdc(2000)),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidParam");
            await d.tradingCore.connect(d.admin).setMinLiquidatorRewardUsdc(usdc(50));
            expect(await d.tradingCore.minLiquidatorRewardUsdc()).to.equal(usdc(50));
        });
    });

    describe("portfolio risk config", () => {
        it("rejects out-of-range bps", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setPortfolioRiskConfig(true, true, 5001, 4000, 20),
            ).to.be.revertedWithCustomError(d.tradingCore, "InvalidParam");
        });
        it("updates config", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).setPortfolioRiskConfig(true, false, 600, 5000, 10);
            const cfg = await d.tradingCore.portfolioRiskConfig();
            expect(cfg.maintenanceMarginBps).to.equal(600);
        });
    });

    describe("RWA contracts rotation (48h timelock)", () => {
        it("first-time wiring is immediate; rotation needs timelock", async () => {
            const d = await loadFixture(deployConfigured);
            // already wired in fixture; a re-set without proposal must revert
            await expect(
                d.tradingCore
                    .connect(d.admin)
                    .setRWAContracts(d.bob.address, d.bob.address, d.bob.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "PendingRWAMismatch");
        });
        it("propose then apply after timelock", async () => {
            const d = await loadFixture(deployConfigured);
            const cal = await d.marketCalendar.getAddress();
            const dm = await d.dividendManager.getAddress();
            const cm = await d.compliance.getAddress();
            await d.tradingCore.connect(d.admin).proposeRWAContracts(cal, dm, cm);
            await expect(
                d.tradingCore.connect(d.admin).setRWAContracts(cal, dm, cm),
            ).to.be.revertedWithCustomError(d.tradingCore, "RWATimelockActive");
            await time.increase(48 * 60 * 60 + 1);
            await expect(d.tradingCore.connect(d.admin).setRWAContracts(cal, dm, cm)).to.emit(
                d.tradingCore,
                "RWAContractsApplied",
            );
        });
    });

    describe("referral registry rotation (48h timelock)", () => {
        it("propose then apply after timelock", async () => {
            const d = await loadFixture(deployConfigured);
            const reg = d.bob.address;
            await d.tradingCore.connect(d.admin).proposeReferralRegistry(reg);
            await expect(
                d.tradingCore.connect(d.admin).setReferralRegistry(reg),
            ).to.be.revertedWithCustomError(d.tradingCore, "ReferralRegistryTimelockActive");
            await time.increase(48 * 60 * 60 + 1);
            await expect(d.tradingCore.connect(d.admin).setReferralRegistry(reg)).to.emit(
                d.tradingCore,
                "ReferralRegistryUpdated",
            );
            expect(await d.tradingCore.referralRegistry()).to.equal(reg);
        });
        it("reverts when applied address mismatches the staged proposal", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.admin).proposeReferralRegistry(d.bob.address);
            await time.increase(48 * 60 * 60 + 1);
            await expect(
                d.tradingCore.connect(d.admin).setReferralRegistry(d.carol.address),
            ).to.be.revertedWithCustomError(d.tradingCore, "PendingReferralRegistryMismatch");
        });
    });

    describe("market id binding", () => {
        it("operator binds a market id", async () => {
            const d = await loadFixture(deployConfigured);
            const m2 = "0x00000000000000000000000000000000000000D9";
            await expect(d.tradingCore.setMarketId(m2, "ETH-USD")).to.emit(d.tradingCore, "MarketIdUpdated");
            expect(await d.tradingCore.marketIds(m2)).to.equal("ETH-USD");
        });
        it("rejects an over-long market id", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.setMarketId(d.bob.address, "X".repeat(33)),
            ).to.be.revertedWithCustomError(d.tradingCore, "MarketIdTooLong");
        });
    });

    describe("pause", () => {
        it("guardian pauses; trading is blocked while paused", async () => {
            const d = await loadFixture(deployConfigured);
            await d.tradingCore.connect(d.guardian).pause();
            await expect(
                d.tradingCore.connect(d.alice).createOrder(
                    {
                        orderType: 0,
                        market: d.market,
                        sizeDelta: usdc(10_000),
                        collateralDelta: usdc(2_000),
                        triggerPrice: 0,
                        isLong: true,
                        maxSlippage: 0,
                        positionId: 0,
                        collateralType: 0,
                        collateralToken: ethers.ZeroAddress,
                        tif: 0,
                        stopLossPrice: 0,
                        takeProfitPrice: 0,
                        visibleSize: 0,
                        twapInterval: 0,
                        isReduceOnly: false,
                        owner: ethers.ZeroAddress,
                    },
                    { value: ethers.parseEther("0.005") },
                ),
            ).to.be.reverted; // EnforcedPause
            await d.tradingCore.connect(d.admin).unpause();
        });
    });

    describe("writeDownBadDebt", () => {
        it("only admin and only decrements", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.alice).writeDownBadDebt(1)).to.be.revertedWithCustomError(
                d.tradingCore,
                "NotAdmin",
            );
            await d.tradingCore.connect(d.admin).writeDownBadDebt(0);
            const [, badDebt] = await d.tradingCore.getProtocolHealthState();
            expect(badDebt).to.equal(0n);
        });
    });

    describe("trusted forwarder", () => {
        it("admin registers a trusted forwarder", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(d.tradingCore.connect(d.admin).setTrustedForwarder(d.bob.address, true)).to.emit(
                d.tradingCore,
                "TrustedForwarderUpdated",
            );
            expect(await d.tradingCore.trustedForwarders(d.bob.address)).to.equal(true);
        });
        it("rejects zero forwarder", async () => {
            const d = await loadFixture(deployConfigured);
            await expect(
                d.tradingCore.connect(d.admin).setTrustedForwarder(ethers.ZeroAddress, true),
            ).to.be.revertedWithCustomError(d.tradingCore, "ZeroAddress");
        });
    });
});
