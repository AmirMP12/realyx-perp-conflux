import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Liquidation Deadlock Fix", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        return { env };
    }

    async function pushPrice(env: any, feedId: string, price: bigint) {
        const now = await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId,
            price,
            1n,
            -8,
            price,
            1n,
            now,
            now
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    it("allows liquidation with large bad debt via FailedRepayment", async function () {
        const { env } = await loadFixture(fixture);
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("DEADLOCK-TEST"));

        // Setup roles
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);

        // Setup market
        await env.trading.connect(env.admin).setMarket(
            market, market, 100,
            ethers.parseUnits("1000000", 6),
            ethers.parseUnits("10000000", 6),
            500, 1000, 86400
        );
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.vault.connect(env.admin).setMaxExposure(market, 10000);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        // Seed liquidity (USDC is 6 decimals in MockUSDC).
        await env.usdc.mintTo(env.admin.address, ethers.parseUnits("50000000", 6));
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.admin).deposit(ethers.parseUnits("2000000", 6), env.admin.address);

        // Insurance large enough for sync cover and so 10% CB headroom stays above a ~$0.8M first hit.
        await env.vault.connect(env.admin).stakeInsurance(ethers.parseUnits("12000000", 6), env.admin.address);

        // Seed trader
        await env.usdc.mintTo(env.alice.address, 100_000_000_000n); // $100k
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        // Open a large leveraged position
        // Size: $1,000,000, Collateral: $50,000 (20x)
        await env.trading.connect(env.alice).createOrder(
            0, market, ethers.parseUnits("1000000", 6), ethers.parseUnits("50000", 6), 0, true, 0, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        // Deep drop + relaxed spot-vs-TWAP tolerance so liquidation is not blocked by deviation checks.
        await env.trading.connect(env.admin).setParams(0, 0, 0, 0, 0, 0, 5000);
        await pushPrice(env, feedId, 10n * 10n ** 8n);

        // Liquidation should now SUCCEED instead of reverting
        await expect(env.trading.connect(env.liquidator).liquidatePosition(1)).to.not.be.reverted;

        // Verify position is liquidated
        const pos = await env.trading.getPosition(1);
        expect(pos.state).to.equal(3); // LIQUIDATED

        // With synchronous insurance cover and sufficient balances, vault repay succeeds and no failed-repayment queue is needed.
        expect(await env.trading.failedRepaymentCount()).to.equal(0n);
    });
});
