import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAllLibraries, deployHarness } from "../helpers/harness";

const e18 = (n: bigint | number) => ethers.parseUnits(n.toString(), 18);
const e6 = (n: bigint | number) => ethers.parseUnits(n.toString(), 6);
const MARKET = "0x00000000000000000000000000000000000000B7";
const ZERO = ethers.ZeroAddress;

// OrderType enum
const MARKET_INCREASE = 0;
const MARKET_DECREASE = 1;

// PosStatus enum
const NONE = 0;
const OPEN = 1;

/**
 * Exercises additional TradingLib open-position guard paths:
 *
 *  - getPositionPnL non-open short-circuit.
 *  - addCollateral risk gates (emergency-on-active, zero oracle price,
 *    oracle-uncertainty band, leverage ceiling).
 *  - updatePositionOwner gates (zero owner, non-open, exposure cap,
 *    self-transfer no-op).
 *  - checkMarketOpen with a wired calendar + market id (the non-default
 *    `calendar.isMarketOpen` path).
 *  - settlePositionFundingWithDividends dividend-manager / market-id /
 *    zero-amount sub-cases.
 *  - _executeIncrease additional paths: zero-TWAP skip, market trigger within
 *    slippage, overwrite-guard.
 *  - _executeDecrease owner mismatch.
 *  - executeStopLossTakeProfit: empty session id with a wired calendar,
 *    zero-TWAP skip, trailing anchor fallback to entry price, dividend
 *    market-id / zero-amount sub-cases, and the per-position referral
 *    resolution against unsafe + reverting registries (_safeGetReferral).
 *  - resolveFailedRepayment happy path with a pre-funded harness.
 *
 * Driven through the additive harness test-only entry points; no new
 * wrappers are added.
 */
async function setup() {
    const [admin, keeper, other] = await ethers.getSigners();
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
    return { h, usdc, vault, oracle, pt, admin, keeper, other, base };
}

async function setNow(oracle: any, price: bigint, twap: bigint) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await oracle.setPrice(MARKET, price, 0, now);
    await oracle.setTWAP(MARKET, twap);
}

describe("TradingLib — open-position guards", () => {
    describe("getPositionPnL state short-circuit", () => {
        it("returns (0,0) for a non-open position id", async () => {
            const { h } = await loadFixture(setup);
            const [pnl, hf] = await h.testGetPositionPnL(42, e18(50_000));
            expect(pnl).to.equal(0n);
            expect(hf).to.equal(0n);
        });
    });

    describe("addCollateral risk gates", () => {
        it("reverts MarketNotActive on an emergency top-up against an active market", async () => {
            const { h, usdc, oracle } = await loadFixture(setup);
            await h.setPositionSimple(1, e18(10_000), e18(50_000), 1, OPEN, MARKET);
            await h.setCollateral(1, e18(2_000));
            await expect(
                h.testAddCollateral(1, e6(100), 100, true, await usdc.getAddress(), await oracle.getAddress(), e18(0.5)),
            ).to.be.reverted;
        });

        it("reverts InvalidOraclePrice when the oracle reports a zero price", async () => {
            const { h, usdc, oracle } = await loadFixture(setup);
            const now = (await ethers.provider.getBlock("latest"))!.timestamp;
            await oracle.setPrice(MARKET, 0, 0, now);
            await h.setPositionSimple(1, e18(10_000), e18(50_000), 1, OPEN, MARKET);
            await h.setCollateral(1, e18(2_000));
            await expect(
                h.testAddCollateral(1, e6(100), 100, false, await usdc.getAddress(), await oracle.getAddress(), e18(0.5)),
            ).to.be.reverted;
        });

        it("reverts InvalidOraclePrice when the confidence band is too wide", async () => {
            const { h, usdc, oracle } = await loadFixture(setup);
            const now = (await ethers.provider.getBlock("latest"))!.timestamp;
            // cfFraction = cf * 1e18 / price = 0.4e18 > maxUncertainty/2 (0.25e18)
            await oracle.setPrice(MARKET, e18(50_000), e18(20_000), now);
            await h.setPositionSimple(1, e18(10_000), e18(50_000), 1, OPEN, MARKET);
            await h.setCollateral(1, e18(2_000));
            await expect(
                h.testAddCollateral(1, e6(100), 100, false, await usdc.getAddress(), await oracle.getAddress(), e18(0.5)),
            ).to.be.reverted;
        });

        it("reverts ExceedsMaxLeverage when the resulting leverage exceeds the cap", async () => {
            const { h, usdc, oracle, admin } = await loadFixture(setup);
            // Fund the EOA and approve the harness for the collateral pull.
            await usdc.mintTo(admin.address, e6(1_000));
            await usdc.connect(admin).approve(await h.getAddress(), e6(1_000));
            await h.setPositionSimple(1, e18(100_000), e18(50_000), 1, OPEN, MARKET);
            await h.setCollateral(1, e18(1));
            await expect(
                h.testAddCollateral(1, e6(1), 1, false, await usdc.getAddress(), await oracle.getAddress(), e18(0.5)),
            ).to.be.reverted;
        });
    });

    describe("updatePositionOwner gates", () => {
        it("reverts ZeroAddress when the new owner is the zero address", async () => {
            const { h, admin } = await loadFixture(setup);
            await h.setPositionSimple(1, e18(10_000), e18(50_000), 1, OPEN, MARKET);
            await expect(h.testUpdatePositionOwner(1, ZERO, admin.address, e6(1_000_000))).to.be.reverted;
        });

        it("reverts PositionNotFound when the position is not open", async () => {
            const { h, admin, keeper } = await loadFixture(setup);
            // position id never opened -> state NONE
            await h.setPositionSimple(2, e18(10_000), e18(50_000), 1, NONE, MARKET);
            await expect(h.testUpdatePositionOwner(2, keeper.address, admin.address, e6(1_000_000))).to.be.reverted;
        });

        it("reverts ExceedsMaxTotalExposure when the new owner would breach the cap", async () => {
            const { h, admin, keeper } = await loadFixture(setup);
            await h.setPositionSimple(1, e18(10_000), e18(50_000), 1, OPEN, MARKET);
            await expect(h.testUpdatePositionOwner(1, keeper.address, admin.address, 0)).to.be.reverted;
        });

        it("is a no-op on a self-transfer (same owner) without reverting", async () => {
            const { h, admin } = await loadFixture(setup);
            await h.setPositionSimple(1, e18(10_000), e18(50_000), 1, OPEN, MARKET);
            await h.testUpdatePositionOwner(1, admin.address, admin.address, e6(1_000_000));
            expect((await h.getDrivenPosition(1)).state).to.equal(OPEN);
        });
    });

    describe("checkMarketOpen with a wired calendar", () => {
        it("delegates to the calendar when both a calendar and a market id are set", async () => {
            const { h } = await loadFixture(setup);
            const Cal = await ethers.getContractFactory("MarketCalendar");
            const cal = await Cal.deploy();
            await cal.waitForDeployment();
            await h.setMarketId(MARKET, "AAPL");
            // unconfigured calendar markets default to closed -> returns false
            expect(await h.testCheckMarketOpen(MARKET, await cal.getAddress())).to.equal(false);
        });
    });

    describe("settlePositionFundingWithDividends", () => {
        it("settles funding with no dividend manager wired", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await h.driveOpen(base);
            await h.testTradingLibSettlePositionFundingWithDividends(1, await oracle.getAddress(), ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(OPEN);
        });

        it("skips dividend settlement when the market id is empty (dm wired)", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Dm = await ethers.getContractFactory("MockDividendManagerConfigurable");
            const dm = await Dm.deploy();
            await dm.waitForDeployment();
            await dm.setSettleResult(e18(5), 1);
            await h.driveOpen(base);
            // no setMarketId -> marketIds[MARKET] empty -> dividend block skipped
            await h.testTradingLibSettlePositionFundingWithDividends(1, await oracle.getAddress(), await dm.getAddress());
            expect((await h.getDrivenPosition(1)).state).to.equal(OPEN);
        });

        it("advances the dividend index without applying funding when divAmount == 0", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Dm = await ethers.getContractFactory("MockDividendManagerConfigurable");
            const dm = await Dm.deploy();
            await dm.waitForDeployment();
            await dm.setSettleResult(0, 1); // index advances, amount zero
            await h.setMarketId(MARKET, "AAPL");
            await h.driveOpen(base);
            await h.testTradingLibSettlePositionFundingWithDividends(1, await oracle.getAddress(), await dm.getAddress());
            expect((await h.getDrivenPosition(1)).state).to.equal(OPEN);
        });
    });

    describe("_executeIncrease additional paths", () => {
        it("opens when the TWAP buffer reports a zero price (deviation skip)", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await oracle.setTWAP(MARKET, 0);
            await oracle.setTWAPValid(MARKET, true);
            await h.driveOpen(base);
            expect((await h.getDrivenPosition(1)).state).to.equal(OPEN);
        });

        it("opens a MARKET_INCREASE with a trigger above price within slippage", async () => {
            const { h, base } = await loadFixture(setup);
            // currentPrice 50_000 < trigger 50_100 -> trigger sits above price within slippage
            await h.driveOpen({ ...base, triggerPrice: e18(50_100), maxSlippage: 100n });
            expect((await h.getDrivenPosition(1)).state).to.equal(OPEN);
        });

        it("reverts InvalidOrder when the target id already holds a position (overwrite guard)", async () => {
            const { h, base } = await loadFixture(setup);
            await h.driveOpen(base);
            // re-open into the same id -> positions[1].state != NONE
            await expect(h.driveOpen(base)).to.be.reverted;
        });
    });

    describe("_executeDecrease owner gate", () => {
        it("reverts NotPositionOwner when the decrease account is not the NFT owner", async () => {
            const { h, base, keeper } = await loadFixture(setup);
            await h.driveOpen(base);
            await expect(h.driveDecrease(1, keeper.address, MARKET_DECREASE, e6(1_000), 0)).to.be.reverted;
        });
    });

    describe("executeStopLossTakeProfit additional scenarios", () => {
        it("proceeds when a calendar is wired but the market id is empty", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Cal = await ethers.getContractFactory("MarketCalendar");
            const cal = await Cal.deploy();
            await cal.waitForDeployment();
            // no setMarketId -> session id empty -> sessionOpen stays true
            await h.driveOpen({ ...base, stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await h.driveExecuteSLTP([1], ZERO, ZERO, await cal.getAddress());
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("triggers when the TWAP buffer reports a zero price (deviation skip)", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await h.driveOpen({ ...base, stopLossPrice: e18(45_000) });
            const now = (await ethers.provider.getBlock("latest"))!.timestamp;
            await oracle.setPrice(MARKET, e18(45_000), 0, now);
            await oracle.setTWAP(MARKET, 0); // twapPrice == 0 -> skip deviation check
            await oracle.setTWAPValid(MARKET, true);
            await h.driveExecuteSLTP([1], ZERO, ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("falls back to the entry price as the trailing anchor when none is set", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            await h.driveOpen(base);
            await h.setDrivenTrailingStop(1, 500); // 5%, but no explicit anchor set
            await setNow(oracle, e18(47_000), e18(47_000)); // 6% retrace from entry
            await h.driveExecuteSLTP([1], ZERO, ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("skips dividend settlement on close when the market id is empty (dm wired)", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Dm = await ethers.getContractFactory("MockDividendManagerConfigurable");
            const dm = await Dm.deploy();
            await dm.waitForDeployment();
            await dm.setSettleResult(e18(5), 1);
            // no setMarketId -> dividend block skipped on the close path
            await h.driveOpen({ ...base, stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await h.driveExecuteSLTP([1], ZERO, await dm.getAddress(), ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("advances the dividend index without funding when divAmount == 0 on close", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Dm = await ethers.getContractFactory("MockDividendManagerConfigurable");
            const dm = await Dm.deploy();
            await dm.waitForDeployment();
            await dm.setSettleResult(0, 1);
            await h.setMarketId(MARKET, "AAPL");
            await h.driveOpen({ ...base, stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await h.driveExecuteSLTP([1], ZERO, await dm.getAddress(), ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("resolves per-position referral data with an unsafe discount+rebate (> BPS) config", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Reg = await ethers.getContractFactory("MockReferralRegistryConfigurable");
            const reg = await Reg.deploy();
            await reg.waitForDeployment();
            // both clamped to BPS and their sum exceeds BPS -> treated as unreferred
            await reg.setData((await ethers.getSigners())[1].address, 20000, 20000, 0);
            await h.driveOpen({ ...base, stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await h.driveExecuteSLTP([1], await reg.getAddress(), ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });

        it("treats the position as unreferred when the registry call reverts", async () => {
            const { h, oracle, base } = await loadFixture(setup);
            const Reg = await ethers.getContractFactory("MockReferralRegistryConfigurable");
            const reg = await Reg.deploy();
            await reg.waitForDeployment();
            await reg.setShouldRevert(true);
            await h.driveOpen({ ...base, stopLossPrice: e18(45_000) });
            await setNow(oracle, e18(45_000), e18(45_000));
            await h.driveExecuteSLTP([1], await reg.getAddress(), ZERO, ZERO);
            expect((await h.getDrivenPosition(1)).state).to.equal(2);
        });
    });

    describe("resolveFailedRepayment happy path", () => {
        it("resolves a record when enough USDC is already held", async () => {
            const { h, usdc } = await loadFixture(setup);
            const Vault = await ethers.getContractFactory("MockVaultControl");
            const vault = await Vault.deploy();
            await vault.waitForDeployment();
            const now = (await ethers.provider.getBlock("latest"))!.timestamp;
            await h.setFailedRepayment(1, {
                amount: e6(100),
                market: MARKET,
                isLong: true,
                pnl: e18(5),
                timestamp: now,
                resolved: false,
            });
            // harness already funded with 10M USDC in setup -> balance >= amount
            const [sender] = await ethers.getSigners();
            await h.testResolveFailedRepayment(1, sender.address, await usdc.getAddress(), await vault.getAddress());
            // a second resolve must revert (record now resolved)
            await expect(
                h.testResolveFailedRepayment(1, sender.address, await usdc.getAddress(), await vault.getAddress()),
            ).to.be.reverted;
        });
    });
});
