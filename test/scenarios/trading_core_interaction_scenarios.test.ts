import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("TradingCore Branch Wave", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        return { env };
    }

    it("covers tradingViews unauthorized guards", async function () {
        const { env } = await loadFixture(fixture);

        await env.trading.connect(env.admin).setTradingViews(ethers.ZeroAddress);
        await expect(env.trading.getPositionPnL(1)).to.be.reverted;
        await expect(env.trading.canLiquidate(1)).to.be.reverted;
        await expect(env.trading.getGlobalUnrealizedPnL()).to.be.reverted;
    });

    it("covers cleanupPositions cap paths for user and admin", async function () {
        const { env } = await loadFixture(fixture);

        await env.trading.connect(env.alice).cleanupPositions(env.alice.address, 999);
        await env.trading.connect(env.admin).cleanupPositions(env.alice.address, 999);
    });

    it("covers fee config validation branches", async function () {
        const { env } = await loadFixture(fixture);

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

        const cur = await env.trading.feeConfig();
        await env.trading.connect(env.admin).setFeeConfig({
            makerFeeBps: cur.makerFeeBps,
            takerFeeBps: cur.takerFeeBps,
            minFeeUsdc: cur.minFeeUsdc,
            lpShareBps: cur.lpShareBps,
            insuranceShareBps: cur.insuranceShareBps,
            treasuryShareBps: cur.treasuryShareBps
        });
    });

    it("covers trusted forwarder and limits branches", async function () {
        const { env } = await loadFixture(fixture);

        await expect(
            env.trading.connect(env.admin).setTrustedForwarder(ethers.ZeroAddress, true)
        ).to.be.reverted;
        const fwd = ethers.Wallet.createRandom().address;
        await env.trading.connect(env.admin).setTrustedForwarder(fwd, true);
        await env.trading.connect(env.admin).setTrustedForwarder(fwd, false);

        await env.trading.connect(env.admin).setLimits(1, 1, 1, 1, 1, 29);
        await env.trading.connect(env.admin).setLimits(2, 2, 2, 2, 2, 30);
        await env.trading.connect(env.admin).setLimits(3, 3, 3, 3, 3, 3600);
    });

    it("covers deadline and refund/keeper withdrawal revert branches", async function () {
        const { env } = await loadFixture(fixture);
        const now = await time.latest();

        await expect(
            env.trading.connect(env.alice).partialClose(1, ethers.parseEther("1"), 0, now - 1)
        ).to.be.reverted;

        await env.trading.connect(env.alice).withdrawKeeperFees();
        await env.trading.connect(env.alice).withdrawOrderRefund();
        await env.trading.connect(env.alice).withdrawOrderCollateralRefund();
    });

    it("covers settle funding and execute stop-loss/take-profit empty path", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;

        await env.trading.connect(env.admin).settleFunding(market);
        await env.trading.connect(env.keeper).executeStopLossTakeProfit([]);
    });
});
