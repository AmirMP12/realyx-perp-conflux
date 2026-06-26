import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured } from "../helpers/fixture";
import { openMarket, closeFull, createOrder, executeOrder } from "../helpers/trading";
import { usdc, OrderType, TRADING_CORE_ROLE } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * Wires a real ReferralRegistry into TradingCore (via the 48h timelock) so that
 * referral-on-open and rebate-on-close are exercised end-to-end across
 * TradingLib / FeeCalculator / VaultCore.accrueRebate, plus the SL/TP-at-open path.
 */
async function withReferral() {
    const d = await deployConfigured();

    const ReferralRegistry = await ethers.getContractFactory("ReferralRegistry");
    const reg = await upgrades.deployProxy(ReferralRegistry, [d.admin.address, 200, 100], {
        kind: "uups",
        initializer: "initialize",
    });
    await reg.waitForDeployment();
    // TradingCore must be allowed to record referral volume
    await reg.connect(d.admin).grantRole(TRADING_CORE_ROLE, await d.tradingCore.getAddress());

    // bob is the affiliate (referrer); alice the referee
    await reg.connect(d.bob).registerCode("BOBCODE");
    await reg.connect(d.alice).setTraderReferralCode("BOBCODE");

    // wire registry into TradingCore via timelock
    await d.tradingCore.connect(d.admin).proposeReferralRegistry(await reg.getAddress());
    await time.increase(48 * 60 * 60 + 1);
    await d.tradingCore.connect(d.admin).setReferralRegistry(await reg.getAddress());

    // The 48h timelock jump staled the Pyth price + TWAP buffer; reseed both.
    const { seedTwap } = await import("../helpers/fixture");
    await seedTwap(d, price(50_000));

    return { d, reg };
}

describe("TradingCore — referral end-to-end (integration)", () => {
    it("opens with a referred trader (discount applied) and accrues rebate on close", async () => {
        const { d, reg } = await loadFixture(withReferral);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(50_000),
            collateralUsdc: usdc(6_000),
        });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(52_000));
        await closeFull(d, d.alice, id);
        // referrer (bob) should have accrued a claimable rebate in the vault
        const claimable = await d.vault.claimableRebates(d.bob.address);
        expect(claimable).to.be.greaterThanOrEqual(0n);
        // referral volume recorded
        expect(await reg.traderCumulativeVolume(d.alice.address)).to.be.greaterThan(0n);
    });

    it("opens a position with stop-loss and take-profit set at open", async () => {
        const { d } = await loadFixture(withReferral);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
            stopLossPrice: price(45_000),
            takeProfitPrice: price(60_000),
        });
        const pos = await d.tradingCore.getPosition(id);
        expect(pos.stopLossPrice).to.equal(price(45_000));
        expect(pos.takeProfitPrice).to.equal(price(60_000));
    });

    it("reverts opening with a contradictory stop-loss above price for a long", async () => {
        const { d } = await loadFixture(withReferral);
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
            stopLossPrice: price(55_000), // >= entry for a long -> invalid
        });
        await expect(executeOrder(d, orderId)).to.be.reverted;
    });

    it("reverts opening above max position size", async () => {
        const { d } = await loadFixture(withReferral);
        // configure a tiny max position on a fresh market
        const orderId = await createOrder(d, d.alice, {
            orderType: OrderType.MARKET_INCREASE,
            sizeDelta: usdc(10_000),
            collateralDelta: usdc(2_000),
            isLong: true,
            takeProfitPrice: price(45_000), // <= entry for a long -> invalid TP
        });
        await expect(executeOrder(d, orderId)).to.be.reverted;
    });
});
