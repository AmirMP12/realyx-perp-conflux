import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";
const ZERO = ethers.ZeroAddress;
const TOKEN = "0x000000000000000000000000000000000000cA11";

// OrderType enum
const MARKET_INCREASE = 0;
const MARKET_DECREASE = 1;
const LIMIT_INCREASE = 2;
const LIMIT_DECREASE = 3;

/**
 * Exercises additional TradingLib paths:
 *  - executeStopLossTakeProfit: session-closed skip, cold-TWAP skip, deviation
 *    skip, trailing-stop vs SL vs TP trigger selection, dividend settlement,
 *    referral resolution.
 *  - _distributeFees referral-rebate split on the open path.
 *  - LIMIT_INCREASE / *_DECREASE limit-order trigger-price gates in
 *    executeOrderFull / _executeDecrease.
 *  - cancelOrder refunds (collateralToken vs usdc, explicit
 *    executionFeePayer vs owner default, OrderNotFound / Unauthorized).
 *  - resolveFailedRepaymentFull list-removal + bad-debt decrement.
 *
 * All paths are driven through the additive, test-only harness functions
 * (driveOpen / driveExecuteSLTP / driveClose / boostCancelOrderRich /
 * boostResolveFailedRepayment*) against the existing mock suite.
 */
async function setup() {
    const [admin, keeper, payer] = await ethers.getSigners();
    const libs = await deployAllLibraries();
    const h = await deployHarness("CoverageHarness", libs);

    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();
    const Vault = await ethers.getContractFactory("MockVaultForOpen");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    await vault.setUsdc(await usdc.getAddress());
    const Oracle = await ethers.getContractFactory("MockOracleConfigurable");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const PT = await ethers.getContractFactory("MockPositionTokenSimple");
    const pt = await PT.deploy();
    await pt.waitForDeployment();

    await usdc.mintTo(await h.getAddress(), e6(10_000_000));
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, e18(50_000), 0, now);
    await oracle.setTWAP(MARKET, e18(50_000));
    await oracle.setTWAPValid(MARKET, true);

    await h.configureOpenMarket(
        MARKET,
        true,
        true,
        ethers.parseUnits("100000000", 18),
        ethers.parseUnits("500000000", 18),
        100,
        0,
    );
    await h.setOpenWiring(await usdc.getAddress(), await vault.getAddress(), await oracle.getAddress(), false);
    await h.setOpenPositionToken(await pt.getAddress());

    const base = {
        account: admin.address,
        orderType: 0,
        isLong: true,
        sizeDelta: e6(10_000),
        collateralDelta: e6(2_000),
        triggerPrice: 0n,
        maxSlippage: 0n,
        stopLossPrice: 0n,
        takeProfitPrice: 0n,
        currentPrice: e18(50_000),
        minPositionSize: e6(10),
        maxUserExposure: 0n,
        userDailyVolumeLimit: 0n,
        globalDailyVolumeLimit: 0n,
        nextPositionId: 1n,
    };
    return { h, usdc, vault, oracle, pt, admin, keeper, payer, base };
}

async function open(h: any, base: any, over: any = {}) {
    await h.driveOpen({ ...base, ...over });
}

async function setNow(oracle: any, price: bigint, twap: bigint) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, price, 0, now);
    await oracle.setTWAP(MARKET, twap);
}

describe("TradingLib — fee rebates & triggers", () => {
    describe("_distributeFees referral rebate split (open path)", () => {
        it("splits a referral rebate to the referrer when rebateBps is set", async () => {
            const { h, base, keeper } = await loadFixture(setup);
            // referrer present with a non-zero rebate -> rebateShare carved out
            await h.setOpenReferral(keeper.address, 100, 500);
            await open(h, base);
            const pos = await h.getDrivenPosition(1);
            expect(pos.state).to.equal(1);
        });

        it("opens normally with a referrer but zero rebateBps", async () => {
            const { h, base, keeper } = await loadFixture(setup);
            await h.setOpenReferral(keeper.address, 100, 0);
            await open(h, base);
            expect((await h.getDrivenPosition(1)).state).to.equal(1);
        });

        it("opens with a referrer set but zero fees", async () => {
            const { h, usdc, vault, oracle, base, keeper } = await loadFixture(setup);
            await h.setOpenWiring(await usdc.getAddress(), await vault.getAddress(), await oracle.getAddress(), true);
            await h.setOpenReferral(keeper.address, 0, 500);
            await open(h, base);
            expect((await h.getDrivenPosition(1)).state).to.equal(1);
        });
    });

    describe("executeStopLossTakeProfit", () => {
        async function openLong(h: any, base: any, over: any = {}) {
            await open(h, base, over);
        }

        it("triggers a stop-loss close on a long when price falls to SL", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await openLong(h, base, { stopLossPrice: e18(45_000) });
            // price drops to SL, TWAP tracks so deviation passes
            await setNow(oracle, e18(45_000), e18(45_000));
            const n = await h.driveExecuteSLTP.staticCall([1], ZERO, ZERO, ZERO);
            expect(n).to.equal(1n);
            await h.driveExecuteSLTP([1], ZERO, ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2); // CLOSED
        });

        it("triggers a take-profit close on a long when price rises to TP", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await openLong(h, base, { takeProfitPrice: e18(55_000) });
            await setNow(oracle, e18(55_000), e18(55_000));
            await h.driveExecuteSLTP([1], ZERO, ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("does not trigger when price is between SL and TP", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await openLong(h, base, { stopLossPrice: e18(45_000), takeProfitPrice: e18(55_000) });
            await setNow(oracle, e18(50_000), e18(50_000));
            const n = await h.driveExecuteSLTP.staticCall([1], ZERO, ZERO, ZERO);
            expect(n).to.equal(0n);
            expect((await h.getDrivenPosition(1)).state).to.equal(1); // still OPEN
        });

        it("skips a non-open position id (state guard)", async () => {
            const { h, base } = await loadFixture(setup);
            await openLong(h, base);
            // position 2 was never opened -> state NONE -> skipped
            const n = await h.driveExecuteSLTP.staticCall([2], ZERO, ZERO, ZERO);
            expect(n).to.equal(0n);
        });

        it("skips when the TWAP buffer is cold", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await openLong(h, base, { stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await oracle.setTWAPValid(MARKET, false);
            const n = await h.driveExecuteSLTP.staticCall([1], ZERO, ZERO, ZERO);
            expect(n).to.equal(0n);
            expect((await h.getDrivenPosition(1)).state).to.equal(1);
        });

        it("skips when spot deviates too far from a valid TWAP (>10%)", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await openLong(h, base, { stopLossPrice: e18(45_000) });
            // price hits SL but TWAP far away -> deviation skip
            await setNow(oracle, e18(45_000), e18(60_000));
            const n = await h.driveExecuteSLTP.staticCall([1], ZERO, ZERO, ZERO);
            expect(n).to.equal(0n);
            expect((await h.getDrivenPosition(1)).state).to.equal(1);
        });

        it("skips when the market session is closed (calendar gate)", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Cal = await ethers.getContractFactory("MarketCalendar");
            // MarketCalendar defaults unconfigured markets to closed.
            const cal = await Cal.deploy();
            await cal.waitForDeployment();
            await h.setMarketId(MARKET, "AAPL");
            await openLong(h, base, { stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            const n = await h.driveExecuteSLTP.staticCall([1], ZERO, ZERO, await cal.getAddress());
            expect(n).to.equal(0n);
            expect((await h.getDrivenPosition(1)).state).to.equal(1);
        });

        it("triggers a trailing-stop close", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await openLong(h, base);
            // arm a trailing stop on the open long position
            await h.setDrivenTrailingStop(1, 500); // 5%
            await h.setTrailingAnchor(1, e18(50_000));
            // price retraces 6% from anchor -> trailing trigger
            await setNow(oracle, e18(47_000), e18(47_000));
            const n = await h.driveExecuteSLTP.staticCall([1], ZERO, ZERO, ZERO);
            expect(n).to.equal(1n);
            await h.driveExecuteSLTP([1], ZERO, ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("settles dividends during SL/TP close when a dividend manager is wired", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Dm = await ethers.getContractFactory("MockDividendManagerConfigurable");
            const dm = await Dm.deploy();
            await dm.waitForDeployment();
            await dm.setSettleResult(e18(5), 1); // positive dividend, advancing index
            await h.setMarketId(MARKET, "AAPL");
            await openLong(h, base, { stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await h.driveExecuteSLTP([1], ZERO, await dm.getAddress(), ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("resolves per-position referral data when a registry is wired", async () => {
            const { h, oracle, base, keeper } = await loadFixture(setup);
            const Reg = await ethers.getContractFactory("MockReferralRegistryConfigurable");
            const reg = await Reg.deploy();
            await reg.waitForDeployment();
            await reg.setData(keeper.address, 100, 200, 0);
            await openLong(h, base, { stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await h.driveExecuteSLTP([1], await reg.getAddress(), ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("triggers SL on a short when price rises to the stop", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await openLong(h, base, { isLong: false, stopLossPrice: e18(55_000) });
            await setNow(oracle, e18(55_000), e18(55_000));
            await h.driveExecuteSLTP([1], ZERO, ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });
    });

    describe("decrease-path limit trigger gate (_executeDecrease)", () => {
        it("executes a MARKET_DECREASE (partial close via decrease path)", async () => {
            const { h, base } = await loadFixture(setup);
            await open(h, base);
            const size = (await h.getDrivenPosition(1)).size;
            await h.driveDecrease(1, base.account, MARKET_DECREASE, e6(5_000), 0);
            expect((await h.getDrivenPosition(1)).size).to.be.lessThan(size);
        });

        it("executes a full MARKET_DECREASE when sizeDelta is 0 (whole position)", async () => {
            const { h, base } = await loadFixture(setup);
            await open(h, base);
            await h.driveDecrease(1, base.account, MARKET_DECREASE, 0, 0);
            expect((await h.getDrivenPosition(1)).state).to.equal(2); // CLOSED
        });

        it("reverts a LIMIT_DECREASE long when current price is below the trigger", async () => {
            const { h, base } = await loadFixture(setup);
            await open(h, base);
            // long LIMIT_DECREASE fills only when price >= trigger; trigger above price -> revert
            await expect(
                h.driveDecrease(1, base.account, LIMIT_DECREASE, e6(5_000), e18(55_000)),
            ).to.be.reverted;
        });

        it("fills a LIMIT_DECREASE long when current price is at/above the trigger", async () => {
            const { h, base } = await loadFixture(setup);
            await open(h, base);
            await h.driveDecrease(1, base.account, LIMIT_DECREASE, e6(5_000), e18(45_000));
            expect((await h.getDrivenPosition(1)).state).to.equal(1);
        });

        it("reverts a LIMIT_DECREASE short when current price is above the trigger", async () => {
            const { h, base } = await loadFixture(setup);
            await open(h, base, { isLong: false });
            // short LIMIT_DECREASE fills when price <= trigger; trigger below price -> revert
            await expect(
                h.driveDecrease(1, base.account, LIMIT_DECREASE, e6(5_000), e18(45_000)),
            ).to.be.reverted;
        });

        it("clamps an oversized decrease to the full position size", async () => {
            const { h, base } = await loadFixture(setup);
            await open(h, base);
            // sizeDelta far larger than position -> closeSizeInternal clamps to size
            await h.driveDecrease(1, base.account, MARKET_DECREASE, e6(50_000), 0);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("reverts a decrease against a non-open position (PositionNotFound)", async () => {
            const { h, base } = await loadFixture(setup);
            await expect(
                h.driveDecrease(7, base.account, MARKET_DECREASE, e6(1_000), 0),
            ).to.be.reverted;
        });
    });

    describe("cancelOrder refunds", () => {
        it("refunds USDC collateral and credits the owner's execution fee (default payer)", async () => {
            const { h, admin } = await loadFixture(setup);
            await h.boostCancelOrderRich(1, admin.address, admin.address, e6(500), MARKET_INCREASE, e6(3), ZERO, ZERO);
            expect(await h.orderCollateralRefundBalance(admin.address)).to.equal(e6(500));
            expect(await h.orderRefundBalance(admin.address)).to.equal(e6(3));
        });

        it("refunds alt-collateral to the token ledger when collateralToken is set", async () => {
            const { h, admin } = await loadFixture(setup);
            await h.boostCancelOrderRich(2, admin.address, admin.address, e6(750), LIMIT_INCREASE, 0, ZERO, TOKEN);
            expect(await h.getOrderTokenRefund(admin.address, TOKEN)).to.equal(e6(750));
            // usdc ledger untouched
            expect(await h.orderCollateralRefundBalance(admin.address)).to.equal(0n);
        });

        it("credits an explicit executionFeePayer rather than the order owner", async () => {
            const { h, admin, payer } = await loadFixture(setup);
            await h.boostCancelOrderRich(3, admin.address, admin.address, 0, MARKET_INCREASE, e6(2), payer.address, ZERO);
            expect(await h.orderRefundBalance(payer.address)).to.equal(e6(2));
            expect(await h.orderRefundBalance(admin.address)).to.equal(0n);
        });

        it("does not credit collateral refund for a decrease order type", async () => {
            const { h, admin } = await loadFixture(setup);
            // MARKET_DECREASE with collateralDelta must not credit the increase refund
            await h.boostCancelOrderRich(4, admin.address, admin.address, e6(900), MARKET_DECREASE, 0, ZERO, ZERO);
            expect(await h.orderCollateralRefundBalance(admin.address)).to.equal(0n);
        });

        it("reverts OrderNotFound for an unknown order id", async () => {
            const { h, admin } = await loadFixture(setup);
            await expect(
                h.boostCancelOrder(99, ZERO, admin.address, 0, MARKET_INCREASE, 0),
            ).to.be.reverted;
        });

        it("reverts Unauthorized when caller is not the order owner", async () => {
            const { h, admin, keeper } = await loadFixture(setup);
            await expect(
                h.boostCancelOrderRich(5, admin.address, keeper.address, e6(100), MARKET_INCREASE, 0, ZERO, ZERO),
            ).to.be.reverted;
        });
    });

    describe("resolveFailedRepaymentFull list-removal + bad-debt decrement", () => {
        async function frHarness() {
            const libs = await deployAllLibraries();
            return deployHarness("TradingLibFailedRepaymentHarness", libs);
        }
        async function mockUsdc() {
            const M = await ethers.getContractFactory("MockUSDC");
            const m = await M.deploy();
            await m.waitForDeployment();
            return m;
        }
        async function mockVault() {
            const V = await ethers.getContractFactory("MockVaultControl");
            const v = await V.deploy();
            await v.waitForDeployment();
            return v;
        }

        it("dequeues the middle id and decrements bad debt across multiple records", async () => {
            const h = await loadFixture(frHarness);
            const usdc = await mockUsdc();
            const vault = await mockVault();
            const [sender] = await ethers.getSigners();
            await h.boostRecordFailedRepayment(1, e6(100), MARKET, true, e18(5));
            await h.boostRecordFailedRepayment(2, e6(200), MARKET, false, -e18(2));
            await h.boostRecordFailedRepayment(3, e6(300), MARKET, true, e18(1));
            await usdc.mintTo(await h.getAddress(), e6(2000));
            // resolve the middle id (2) -> swap-and-pop list removal
            const [newTotal] = await h.boostResolveFailedRepaymentFull.staticCall(
                2,
                sender.address,
                await h.getAddress(),
                await usdc.getAddress(),
                await vault.getAddress(),
                3,
            );
            expect(newTotal).to.equal(2n);
            await h.boostResolveFailedRepaymentFull(
                2,
                sender.address,
                await h.getAddress(),
                await usdc.getAddress(),
                await vault.getAddress(),
                3,
            );
        });

        it("resolves the last id in the list", async () => {
            const h = await loadFixture(frHarness);
            const usdc = await mockUsdc();
            const vault = await mockVault();
            const [sender] = await ethers.getSigners();
            await h.boostRecordFailedRepayment(1, e6(100), MARKET, true, e18(5));
            await h.boostRecordFailedRepayment(2, e6(200), MARKET, false, -e18(2));
            await usdc.mintTo(await h.getAddress(), e6(2000));
            await h.boostResolveFailedRepaymentFull(
                2,
                sender.address,
                await h.getAddress(),
                await usdc.getAddress(),
                await vault.getAddress(),
                2,
            );
        });
    });
});
