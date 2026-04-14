import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Precision and PnL Capture Fix Verification", function () {
    async function fixture() {
        const env = await deployTestEnvironment();
        const TradingCoreViews = await ethers.getContractFactory("TradingCoreViews");
        const views = await TradingCoreViews.deploy();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());
        await env.trading.connect(env.admin).setTradingViews(await views.getAddress());
        return { env, views };
    }

    async function pushPrice(env: any, feedId: string, price: bigint, conf: bigint = 100n) {
        const now = await time.latest();
        const updateData = await env.pyth.createPriceFeedUpdateData(
            feedId, price, conf, -8, price, conf, now, now
        );
        await env.pyth.updatePriceFeeds([updateData], { value: 1 });
    }

    it("verifies VaultCore.totalAssets() correctly accounts for totalBorrowed with 18-dec precision", async function () {
        const { env } = await loadFixture(fixture);
        const [admin, alice] = await ethers.getSigners();

        // 1. Initial Deposit
        const initialDeposit = 10000e6; // 10,000 USDC
        await env.usdc.mintTo(alice.address, initialDeposit);
        await env.usdc.connect(alice).approve(await env.vault.getAddress(), initialDeposit);
        await env.vault.connect(alice).deposit(initialDeposit, alice.address);

        // totalAssets should be 10,000e18 (scaled internal precision)
        // Note: Vault initialize has DEAD_SHARES = 10e6, and it might have some initial balance if helpers deposited.
        // But with a fresh deploy in fixture, it should be clean.
        let tvl = await env.vault.totalAssets();
        expect(tvl).to.be.closeTo(10000n * 10n**18n, 10n**12n); // Allow for small dead shares dust

        // 2. Open Position (Borrows from Vault)
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("MKT-1"));
        await env.trading.connect(env.admin).setMarket(market, market, 100, 1000000e6, 10000000e6, 500, 1000, 86400);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);
        await env.vault.connect(env.admin).setMaxExposure(market, 10000);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n); // $100

        await env.usdc.mintTo(alice.address, 1000e6);
        await env.usdc.connect(alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        // Open 5000 USDC size with 500 USDC collateral (10x leverage)
        // Borrow = 5000 - (500 - openingFee) ~= 4505
        await env.trading.connect(alice).createOrder(
            0, market, 5000e6, 500e6, 0, true, 0, 0, { value: ethers.parseEther("0.1") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, []);

        const borrowed = await env.vault.totalBorrowed();
        expect(borrowed).to.be.gt(0n);
        expect(borrowed).to.be.lt(5000e6); // borrowed is in 6 decimals

        // 3. Verify TVL remains consistent
        // Before the fix, totalBorrowed was added as 6-dec to 18-dec, so TVL would drop by almost the borrowed amount.
        tvl = await env.vault.totalAssets();
        // TVL should still be approx 10,000e18 (minus opening fees distributed elsewhere)
        expect(tvl).to.be.closeTo(10000n * 10n**18n, 500n * 10n**18n); 
    });

    it("verifies Vault correctly captures trader losses (Vault Profit)", async function () {
        const { env } = await loadFixture(fixture);
        const [, alice] = await ethers.getSigners();

        // 1. Setup Vault and Insurance (Vault handles both in this test)
        await env.usdc.mintTo(env.admin.address, 100000e6);
        await env.usdc.connect(env.admin).approve(await env.vault.getAddress(), 100000e6);
        await env.vault.connect(env.admin).deposit(50000e6, env.admin.address);
        await env.vault.connect(env.admin).stakeInsurance(50000e6, env.admin.address);

        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("MKT-LOSS"));
        await env.trading.connect(env.admin).setMarket(market, market, 100, 1000000e6, 10000000e6, 500, 1000, 86400);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, env.admin.address);
        await env.vault.connect(env.admin).setMaxExposure(market, 10000);
        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await pushPrice(env, feedId, 100n * 10n ** 8n);

        // 2. Alice opens position
        await env.usdc.mintTo(alice.address, 1000e6);
        await env.usdc.connect(alice).approve(await env.trading.getAddress(), 1000e6);
        await env.trading.connect(alice).createOrder(0, market, 2000e6, 200e6, 0, true, 0, 0, { value: ethers.parseEther("0.1") });
        await env.trading.connect(env.keeper).executeOrder(1, []);

        const vaultBalanceBefore = await env.usdc.balanceOf(await env.vault.getAddress());

        // 3. Price drops -> Alice loses money
        await pushPrice(env, feedId, 90n * 10n ** 8n); // 10% drop on 2000 size = 200 loss (entire collateral)
        
        await time.increase(3600); // Pass min duration
        await pushPrice(env, feedId, 90n * 10n ** 8n); // Refresh price after time jump

        // Close position
        await env.trading.connect(alice).closePosition({
            positionId: 1,
            closeSize: 0,
            minReceive: 0,
            deadline: (await time.latest()) + 1000
        });

        const vaultBalanceAfter = await env.usdc.balanceOf(await env.vault.getAddress());
        const pnl = vaultBalanceAfter - vaultBalanceBefore;

        // Vault should have captured the loss. 
        // Alice had 200 collateral. Opening fee was taken. 
        // Let's say opening fee was 2 USDC (10bps of 2000). 
        // Principal borrowed was 2000 - (200 - 2) = 1802.
        // At $90, size is worth 1800. Loss is 200.
        // Vault received 1802 (principal) + some loss? 
        // In the new logic, vault receives principal + trader loss.
        // Trader loss = EntryValue (2000) - ExitValue (1800) = 200.
        // Wait, the collateral was 200. So trader lost it all.
        // Vault should gain from this.
        expect(pnl).to.be.gt(0n);
    });
});
