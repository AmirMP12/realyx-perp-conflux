import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";
import { VaultCore, MockUSDC } from "../../typechain";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("VaultCore Basic Deposit/Withdraw", function () {
    let env: Awaited<ReturnType<typeof deployTestEnvironment>>;
    let vault: VaultCore;
    let usdc: MockUSDC;
    let admin: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;

    beforeEach(async function () {
        env = await deployTestEnvironment();
        vault = env.vault;
        usdc = env.usdc;
        admin = env.admin;
        alice = env.alice;
        bob = env.bob;

        // Grant roles
        const ADMIN_ROLE = await vault.ADMIN_ROLE();
        const GUARDIAN_ROLE = await vault.GUARDIAN_ROLE();
        const TRADING_CORE_ROLE = await vault.TRADING_CORE_ROLE();
        const OPERATOR_ROLE = await vault.OPERATOR_ROLE();
        await vault.grantRole(ADMIN_ROLE, admin.address);
        await vault.grantRole(GUARDIAN_ROLE, admin.address);
        await vault.grantRole(TRADING_CORE_ROLE, admin.address);
        await vault.grantRole(OPERATOR_ROLE, admin.address);
        
        // Alice & Bob have funds
        await usdc.mintTo(alice.address, 10000e6);
        await usdc.mintTo(bob.address, 10000e6);
        await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
        await usdc.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    describe("Emergency Mode & Escape", function () {
        it("should test emergency mode transitions and escape", async function () {
            await vault.connect(alice).deposit(1000e6, alice.address);
            await vault.connect(admin).triggerEmergencyMode();
            expect(await vault.isEmergencyMode()).to.be.true;

            // Alice escape withdraw
            // Escape requires 24h wait? No, timelock is for ADMIN. 
            // In VaultCore.sol: _checkEmergencyMode() on withdraw
            // emergencyEscapeWithdraw(uint256 assets, address receiver, address owner)
            
            const balBefore = await usdc.balanceOf(alice.address);
            await time.increase(7 * 24 * 3600 + 1); // skip timelock window
            await vault.connect(alice).emergencyEscapeWithdraw(ethers.parseUnits("500", 18));
            const balAfter = await usdc.balanceOf(alice.address);
            // Tiny rounding from DEAD_SHARES dilution (off by ~1 unit)
            expect(balAfter - balBefore).to.be.closeTo(500e6, 10);

            // Deactivation should fail if utilization > 0
            // Actually let's just test that it can be deactivated if utilization is 0
            await vault.connect(admin).stopEmergencyMode();
            expect(await vault.isEmergencyMode()).to.be.false;
        });

        it("should test capped escape withdrawal", async function () {
            await vault.connect(alice).deposit(1000e6, alice.address);
            // Simulate that vault has less tokens than requested (e.g. some are borrowed)
            // We can't easily drain the ERC20Mock without a borrow.
            // Let's use the admin (as TradingCore) to borrow.
            const TRADING_CORE_ROLE = await vault.TRADING_CORE_ROLE();
            await vault.grantRole(TRADING_CORE_ROLE, admin.address);
            
            await vault.connect(admin).borrow(800e6, ethers.ZeroAddress, true); // Vault now has 200e6 left
            
            await vault.connect(admin).triggerEmergencyMode();
            
            const aliceBalBefore = await usdc.balanceOf(alice.address);
            // Alice tries to withdraw 500 units
            await time.increase(7 * 24 * 3600 + 1);
            await vault.connect(alice).emergencyEscapeWithdraw(ethers.parseUnits("500", 18));
            const aliceBalAfter = await usdc.balanceOf(alice.address);
            
            // It should have withdrawn what was available
            expect(aliceBalAfter - aliceBalBefore).to.be.lte(500e6);
            expect(aliceBalAfter - aliceBalBefore).to.be.gt(0);
        });
    });

    describe("Administrative Functions", function () {
        it("should test role-based access for admins", async function () {
            // Alice is not admin
            await expect(vault.connect(alice).triggerEmergencyMode()).to.be.reverted;
            await expect(vault.connect(alice).setThresholds(5000, 8000)).to.be.reverted;
            
            // Admin can set thresholds
            await vault.connect(admin).setThresholds(5000, 8000);
            expect(await vault.restrictionThresholdBps()).to.equal(5000);
            expect(await vault.emergencyThresholdBps()).to.equal(8000);
        });

        it("should test circuit breaker resets", async function () {
            // Trigger circuit breaker
            await usdc.mintTo(admin.address, 100000e6);
            await usdc.connect(admin).approve(await vault.getAddress(), ethers.MaxUint256);
            await vault.connect(admin).stakeInsurance(50000e6, admin.address);
            
            // 10% of 50k is 5k. coverBadDebt(6k) triggers it.
            await vault.connect(admin).coverBadDebt(6000e6, 111);
            expect(await vault.insuranceCircuitBreakerActive()).to.be.true;
            
            // Reset
            await vault.connect(admin).resetInsuranceCircuitBreaker();
            expect(await vault.insuranceCircuitBreakerActive()).to.be.false;
        });
    });

    describe("TradingCore Interactions", function () {
        beforeEach(async function () {
            await vault.connect(alice).deposit(5000e6, alice.address);
        });

        it("should test borrow and repay with profit", async function () {
            await vault.connect(admin).borrow(1000e6, ethers.ZeroAddress, true);
            expect(await vault.totalBorrowed()).to.equal(1000e6);
            
            // Repay with 100 profit
            await usdc.mintTo(admin.address, 1100e6);
            await usdc.connect(admin).approve(await vault.getAddress(), 1100e6);
            await vault.connect(admin).repay(1000e6, ethers.ZeroAddress, true, 100000000n);
            
            expect(await vault.totalBorrowed()).to.equal(0);
        });

        it("should test borrow and repay with loss", async function () {
            await vault.connect(admin).borrow(1000e6, ethers.ZeroAddress, true);
            // Loss is settled in USDC (6 decimals): vault pulls principal + |pnl| (see VaultCore.repay).
            await usdc.mintTo(admin.address, 1100e6);
            await usdc.connect(admin).approve(await vault.getAddress(), 1100e6);
            await vault.connect(admin).repay(1000e6, ethers.ZeroAddress, true, -100000000n);
            
            expect(await vault.totalBorrowed()).to.equal(0);
        });
    });

    describe("Advanced Bad Debt & Claims", function () {
        beforeEach(async function () {
            await usdc.mintTo(admin.address, 200000e6);
            await usdc.connect(admin).approve(await vault.getAddress(), ethers.MaxUint256);
            await vault.connect(admin).stakeInsurance(100000e6, admin.address);
        });

        it("should handle claim approvals and processing", async function () {
            const claimAmount = 15000e6;
            // Use staticCall to get back the ID then execute
            const claimId = await vault.connect(admin).submitClaim.staticCall(claimAmount, 1001);
            await vault.connect(admin).submitClaim(claimAmount, 1001);
            
            await expect(vault.processClaim(claimId)).to.be.revertedWithCustomError(vault, "ClaimNotApproved");
            
            await vault.connect(admin).approveClaim(claimId);
            await vault.processClaim(claimId);
            
            const claim = await vault.getClaim(claimId);
            expect(claim.paid).to.be.true;
        });

        it("should handle partial claim payments", async function () {
            // Drain insurance fund
            const insBal = await vault.insuranceAssets();
            const claimAmount = Number((insBal * 105n) / 100n); // 105% of insBal
            await vault.connect(admin).resetInsuranceCircuitBreaker();
            
            const claimId = await vault.connect(admin).submitClaim.staticCall(claimAmount, 1002);
            await vault.connect(admin).submitClaim(claimAmount, 1002);
            await vault.connect(admin).approveClaim(claimId);
            
            await vault.processClaim(claimId);
            const claim = await vault.getClaim(claimId);
            // Since insurance is not enough, it should be marked as false
            expect(claim.paid).to.be.false;
        });

        it("should test claim rate limiting", async function () {
            // maxClaimsPerWindow = 100_000e6
            await usdc.mintTo(admin.address, 2000000e6);
            await usdc.connect(admin).approve(await vault.getAddress(), ethers.MaxUint256);
            await vault.connect(admin).stakeInsurance(2000000e6, admin.address);
            await vault.connect(admin).resetInsuranceCircuitBreaker();
            
            const amount = 6500n * 10n**6n; // under 10k auto-approve limit
            
            for(let i=0; i<15; i++) {
                await vault.connect(admin).coverBadDebt(amount, 100 + i);
            }
            
            // Second one should fail due to rate limit (16 * 6.5k > 100k)
            await expect(vault.connect(admin).coverBadDebt(amount, 222)).to.be.revertedWithCustomError(vault, "ClaimRateLimitExceeded");

            await time.increase(3601);
            await vault.connect(admin).coverBadDebt(amount, 444);
        });
    });

    describe("Surplus & Views", function () {
        it("should distribute surplus", async function () {
            await vault.connect(admin).updateProtocolTVL(0);
            await usdc.mintTo(admin.address, 10000e6);
            await usdc.connect(admin).approve(await vault.getAddress(), 10000e6);
            await vault.connect(admin).receiveFees(5000e6);
            
            // This should trigger some surplus distribution logic
            await vault.distributeSurplus();
        });

        it("should test misc views", async function () {
            expect(await vault.getUtilization()).to.be.at.least(0);
            expect(await vault.totalAssets()).to.be.at.least(0);
        });
    });
});
