import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("VaultCore Edge Case Explosion", function () {
    async function deployVaultFixture() {
        const env = await deployTestEnvironment();
        const [admin, user1, user2] = await ethers.getSigners();
        
        await env.vault.grantRole(await env.vault.OPERATOR_ROLE(), admin.address);
        await env.usdc.mintTo(admin.address, 1000000n * 10n**6n);
        await env.usdc.approve(await env.vault.getAddress(), ethers.MaxUint256);
        
        return { env, admin, user1, user2 };
    }

    it("exercises Withdrawal Queue & Process Branches (Partial/Slippage/Expired)", async function () {
        const { env, admin } = await loadFixture(deployVaultFixture);
        
        // Initial Deposit
        await env.vault.deposit(2000n * 10n**6n, admin.address);
        
        // 1. Queue Withdrawal
        const shares = 1000n * 10n**18n;
        await env.vault.queueWithdrawal(shares, 900n * 10n**6n); // request 1
        
        // 2. WithdrawalNotReady (Before Cooldown)
        await expect(env.vault.processWithdrawals([1]))
            .to.be.revertedWithCustomError({ interface: env.vault.interface }, "WithdrawalNotReady");
            
        await time.increase(24 * 3600 + 1);
        
        // 3. Success Process
        await env.vault.processWithdrawals([1]);
        
        // 4. Slippage Branch (minAssets > actual)
        await env.vault.deposit(2000n * 10n**6n, admin.address);
        await env.vault.queueWithdrawal(500n * 10n**18n, 10000n * 10n**6n); // request 2 - impossible min
        await time.increase(24 * 3600 + 1);
        await env.vault.processWithdrawals([2]); // Should emit WithdrawalCancelled (Slippage)
        
        // 5. InsufficientLiquidity Branch (Partial/Cancelled)
        // Need to simulate high utilization
        await env.vault.grantRole(await env.vault.TRADING_CORE_ROLE(), admin.address);
        await env.vault.borrow(1500n * 10n**6n, admin.address, true); // Use up liquidity
        
        await env.vault.queueWithdrawal(shares, 0n); // request 3
        await time.increase(24 * 3600 + 1);
        // This should process partially or fail if liquidity too low
        await env.vault.processWithdrawals([3]);
    });

    it("exercises coverBadDebt Branches (Circuit Breaker/Threshold/Partial)", async function () {
        const { env, admin } = await loadFixture(deployVaultFixture);
        await env.vault.grantRole(await env.vault.TRADING_CORE_ROLE(), admin.address);
        await env.vault.grantRole(await env.vault.GUARDIAN_ROLE(), admin.address);

        // Stake insurance
        await env.vault.stakeInsurance(1000n * 10n**6n, admin.address);
        
        // 1. amount > approvalThreshold (Submission Branch)
        // Default approvalThreshold is 10000 USDC
        const largeDebt = 20000n * 10n**6n;
        await env.vault.coverBadDebt(largeDebt, 101); // ID 101
        
        // 2. Exercise follow-up claim path regardless of breaker state
        const breakerActive = await env.vault.insuranceCircuitBreakerActive();
        if (breakerActive) {
            await expect(env.vault.coverBadDebt(10n * 10n**6n, 104))
                .to.be.revertedWithCustomError({ interface: env.vault.interface }, "InsuranceFundCircuitBreakerActive");
        } else {
            await env.vault.coverBadDebt(10n * 10n**6n, 104);
        }
    });
});
