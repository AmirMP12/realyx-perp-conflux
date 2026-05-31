import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, seedTwap } from "../helpers/fixture";
import { openMarket, closeFull } from "../helpers/trading";
import { usdc, PosStatus } from "../helpers/constants";
import { setPythPrice } from "../helpers/pyth";

const price = (n: number) => BigInt(n) * 10n ** 18n;

/**
 * End-to-end scenarios that exercise multiple subsystems together: LP funding,
 * multi-trader books, funding accrual, dividends, liquidation, and LP exit —
 * verifying protocol-level invariants hold across full lifecycles.
 */
describe("E2E — full protocol scenarios", () => {
    it("two traders take opposing sides; both close; vault stays solvent", async () => {
        const d = await loadFixture(deployConfigured);
        const longId = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(30_000),
            collateralUsdc: usdc(5_000),
        });
        const shortId = await openMarket(d, d.bob, {
            isLong: false,
            sizeUsdc: usdc(30_000),
            collateralUsdc: usdc(5_000),
        });

        await time.increase(300);
        await setPythPrice(d.pyth, d.feedId, price(52_000)); // +4%

        await closeFull(d, d.alice, longId);
        await closeFull(d, d.bob, shortId);

        expect((await d.tradingCore.getPosition(longId)).state).to.equal(PosStatus.CLOSED);
        expect((await d.tradingCore.getPosition(shortId)).state).to.equal(PosStatus.CLOSED);
        // Vault retains liquidity (LP assets remain meaningful)
        expect(await d.vault.getAvailableLiquidity()).to.be.greaterThan(0n);
    });

    it("LP deposits, trader profits, LP withdraws at a fair share price", async () => {
        const d = await loadFixture(deployConfigured);
        // a second LP joins
        await d.usdc.mintTo(d.carol.address, usdc(1_000_000));
        await d.usdc.connect(d.carol).approve(await d.vault.getAddress(), ethers.MaxUint256);
        await d.vault.connect(d.carol).deposit(usdc(1_000_000), d.carol.address);
        const carolShares = await d.vault.lpBalanceOf(d.carol.address);

        // trading happens
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(20_000), collateralUsdc: usdc(4_000) });
        await time.increase(300);
        await setPythPrice(d.pyth, d.feedId, price(49_000));
        await closeFull(d, d.alice, id);

        // carol exits instantly (healthy liquidity)
        const before = await d.usdc.balanceOf(d.carol.address);
        await d.vault.connect(d.carol).withdraw(carolShares, d.carol.address, d.carol.address);
        const got = (await d.usdc.balanceOf(d.carol.address)) - before;
        // LP got roughly principal back (within fees/PnL), and strictly positive
        expect(got).to.be.greaterThan(usdc(900_000));
    });

    it("dividend distribution adjusts long position collateral on settlement", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(50_000), collateralUsdc: usdc(6_000) });
        const [colBefore] = await d.tradingCore.getPositionCollateral(id);

        // distribute a dividend on the market id; longs receive it
        await d.dividendManager.distributeDividend(d.marketId, ethers.parseUnits("1", 18));
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(50_000));
        await d.tradingCore.settlePositionFunding(id);

        const [colAfter] = await d.tradingCore.getPositionCollateral(id);
        // long receives dividend -> collateral should not decrease from dividends
        expect(colAfter).to.be.greaterThanOrEqual(colBefore - usdc(1)); // allow tiny funding noise
    });

    it("liquidation cascade keeps protocol health flag intact", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(20_000),
            collateralUsdc: usdc(2_100),
        });
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, price(46_500));
        await seedTwap(d, price(46_500));
        await d.tradingCore.connect(d.liquidator).liquidatePosition(id);

        await d.tradingCore.connect(d.keeper).updateProtocolHealth();
        const [healthy] = await d.tradingCore.getProtocolHealthState();
        expect(healthy).to.equal(true);
    });

    it("global pause halts new opens then resumes after expiry", async () => {
        const d = await loadFixture(deployConfigured);
        await d.oracle.connect(d.guardian).activateGlobalPause();
        // breaker gate on increase orders should block creation
        await expect(
            openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) }),
        ).to.be.reverted;

        await time.increase(6 * 60 * 60 + 1);
        await d.oracle.expireGlobalPause();
        // reseed price after the long time jump and resume
        await setPythPrice(d.pyth, d.feedId, price(50_000));
        await seedTwap(d, price(50_000));
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
        expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.OPEN);
    });

    it("position NFT transfer migrates ownership and trading rights", async () => {
        const d = await loadFixture(deployConfigured);
        const id = await openMarket(d, d.alice, { isLong: true, sizeUsdc: usdc(10_000), collateralUsdc: usdc(2_000) });
        // bob must be compliant to receive (already whitelisted in fixture)
        await d.positionToken.connect(d.alice).transferFrom(d.alice.address, d.bob.address, id);
        expect(await d.positionToken.ownerOf(id)).to.equal(d.bob.address);
        // now bob can manage; triggers cleared on transfer
        await time.increase(120);
        const deadline = (await time.latest()) + 3600;
        await d.tradingCore.connect(d.bob).closePosition({ positionId: id, closeSize: 0, minReceive: 0, deadline });
        expect((await d.tradingCore.getPosition(id)).state).to.equal(PosStatus.CLOSED);
    });
});
