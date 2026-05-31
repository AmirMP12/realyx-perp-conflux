import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployConfigured, deployProtocol } from "./helpers/fixture";
import { openMarket, closeFull } from "./helpers/trading";
import { usdc, PosStatus } from "./helpers/constants";
import { setPythPrice } from "./helpers/pyth";

describe("Smoke: deployment + full trade lifecycle", () => {
    it("deploys the full protocol and wires dependencies", async () => {
        const d = await loadFixture(deployProtocol);
        expect(await d.tradingCore.vaultCore()).to.equal(await d.vault.getAddress());
        expect(await d.tradingCore.oracleAggregator()).to.equal(await d.oracle.getAddress());
        expect(await d.tradingCore.positionToken()).to.equal(await d.positionToken.getAddress());
        expect(await d.vault.tradingCore()).to.equal(await d.tradingCore.getAddress());
        expect(await d.positionToken.tradingCore()).to.equal(await d.tradingCore.getAddress());
    });

    it("configures a market with a live price and seeded LP", async () => {
        const d = await loadFixture(deployConfigured);
        const info = await d.tradingCore.getMarketInfo(d.market);
        expect(info.isListed).to.equal(true);
        expect(info.isActive).to.equal(true);
        const [price] = await d.oracle.getPrice(d.market);
        expect(price).to.equal(50_000n * 10n ** 18n);
        expect(await d.vault.lpAssets()).to.equal(usdc(5_000_000));
    });

    it("opens a long position via create+execute and records it", async () => {
        const d = await loadFixture(deployConfigured);
        const posId = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        const pos = await d.tradingCore.getPosition(posId);
        expect(pos.state).to.equal(PosStatus.OPEN);
        expect(await d.positionToken.ownerOf(posId)).to.equal(d.alice.address);
    });

    it("closes a position in profit after a favorable price move", async () => {
        const d = await loadFixture(deployConfigured);
        const posId = await openMarket(d, d.alice, {
            isLong: true,
            sizeUsdc: usdc(10_000),
            collateralUsdc: usdc(2_000),
        });
        // advance past min position duration (30s) and move price up 10%
        await time.increase(120);
        await setPythPrice(d.pyth, d.feedId, 55_000n * 10n ** 18n);
        const balBefore = await d.usdc.balanceOf(d.alice.address);
        await closeFull(d, d.alice, posId);
        const balAfter = await d.usdc.balanceOf(d.alice.address);
        expect(balAfter).to.be.greaterThan(balBefore);
        const pos = await d.tradingCore.getPosition(posId);
        expect(pos.state).to.equal(PosStatus.CLOSED);
    });
});
