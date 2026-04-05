import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "./helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("VaultCore Extended Coverage", function () {
    let env: any;
    let guardian: any;
    let operator: any;
    let MARKET: string;
    const USDC_DECIMALS = 6;

    beforeEach(async function () {
        env = await deployTestEnvironment();
        const signers = await ethers.getSigners();
        guardian = signers[6];
        operator = signers[7];

        const GUARDIAN_ROLE = await env.vault.GUARDIAN_ROLE();
        const OPERATOR_ROLE = await env.vault.OPERATOR_ROLE();
        const TRADING_CORE_ROLE = await env.vault.TRADING_CORE_ROLE();

        await env.vault.connect(env.admin).grantRole(GUARDIAN_ROLE, guardian.address);
        await env.vault.connect(env.admin).grantRole(OPERATOR_ROLE, operator.address);
        await env.vault.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.alice.address);

        // Add a market
        MARKET = env.bob.address;
        
        // Initial setup
        await env.usdc.connect(env.admin).mintTo(env.alice.address, 1000000e6);
        await env.usdc.connect(env.alice).approve(await env.vault.getAddress(), ethers.MaxUint256);
        
        // Initial deposit to have some liquidity
        await env.vault.connect(env.alice).deposit(50000e6, env.alice.address);
    });

    describe("Emergency Mode", function () {
        it("should allow guardian to activate emergency mode", async function () {
            console.log("DEBUG: Calling triggerEmergencyMode...");
            try {
                const tx = await env.vault.connect(guardian).triggerEmergencyMode();
                console.log("DEBUG: TX hash:", tx.hash);
                await tx.wait();
            } catch (e: any) {
                console.log("DEBUG: ERROR in triggerEmergencyMode:", e.code, e.message);
                throw e;
            }
            
            console.log("DEBUG: Checking isEmergencyMode...");
            try {
                const isEM = await env.vault.isEmergencyMode();
                console.log("DEBUG: isEmergencyMode result:", isEM);
                expect(isEM).to.be.true;
            } catch (e: any) {
                console.log("DEBUG: ERROR in isEmergencyMode:", e.code, e.message);
                throw e;
            }
        });

        it("should prevent deposits/withdrawals/borrows in emergency mode", async function () {
            await env.vault.connect(guardian).triggerEmergencyMode();
            
            await expect(env.vault.connect(env.alice).deposit(1000e6, env.alice.address))
                .to.be.revertedWithCustomError(env.vault, "EmergencyModeActive");
            
            await expect(env.vault.connect(env.alice).withdraw(ethers.parseUnits("1000", 18), env.alice.address, env.alice.address))
                .to.be.revertedWithCustomError(env.vault, "EmergencyModeActive");
        });

        it("should allow admin to deactivate emergency mode", async function () {
            await env.vault.connect(guardian).triggerEmergencyMode();
            await expect(env.vault.connect(env.admin).stopEmergencyMode())
                .to.emit(env.vault, "EmergencyModeDeactivated");
            expect(await env.vault.isEmergencyMode()).to.be.false;
        });

        it("should allow emergency escape withdrawal after timelock", async function () {
            await env.vault.connect(guardian).triggerEmergencyMode();
            
            const shares = await env.vault.lpBalanceOf(env.alice.address);
            
            // Try before timelock
            await expect(env.vault.connect(env.alice).emergencyEscapeWithdraw(shares))
                .to.be.revertedWithCustomError(env.vault, "EscapeTimelockNotExpired");
            
            // Wait 7 days
            await time.increase(7 * 24 * 3600 + 1);
            
            const balBefore = await env.usdc.balanceOf(env.alice.address);
            await env.vault.connect(env.alice).emergencyEscapeWithdraw(shares);
            const balAfter = await env.usdc.balanceOf(env.alice.address);
            
            expect(balAfter).to.be.gt(balBefore);
            expect(await env.vault.lpBalanceOf(env.alice.address)).to.equal(0);
        });
    });

    describe("Admin Functions", function () {
        it("should allow setting treasury and max exposure", async function () {
            await env.vault.connect(env.admin).setTreasury(env.bob.address);
            expect(await env.vault.treasury()).to.equal(env.bob.address);
            
            await env.vault.connect(operator).setMaxExposure(MARKET, 3000n);
            const exp = await env.vault.getMarketExposure(MARKET);
            expect(exp.maxExposurePercent).to.equal(3000);
        });
    });
});
