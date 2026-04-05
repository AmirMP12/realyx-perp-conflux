import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployTestEnvironment } from "./helpers";

describe("VaultCore - Unit Tests", function () {
    let env: any;
    let admin: SignerWithAddress;
    let user1: SignerWithAddress;
    let receiver: SignerWithAddress;

    beforeEach(async () => {
        env = await deployTestEnvironment();
        admin = env.admin;
        user1 = env.alice;
        receiver = env.bob;

        // Mint USDC to user1
        await env.usdc.connect(admin).mintTo(user1.address, ethers.parseUnits("2000000", 6));
        await env.usdc.connect(user1).approve(await env.vault.getAddress(), ethers.MaxUint256);

        // Deposit LP assets to ensure totalAssets > 0 (for Exposure check)
        await env.vault.connect(user1).deposit(ethers.parseUnits("1000000", 6), user1.address);
    });

    describe("Insurance Fund", function () {
        it("should stake insurance assets", async function () {
            const assets = ethers.parseUnits("1000", 6);
            await env.vault.connect(user1).stakeInsurance(assets, user1.address);

            const shares = await env.vault.insBalanceOf(user1.address);
            expect(shares).to.be.gt(0);
        });

        it("should request and execute unstake", async function () {
            const assets = ethers.parseUnits("1000", 6);
            await env.vault.connect(user1).stakeInsurance(assets, user1.address);

            await env.vault.connect(user1).requestUnstake();

            // Fast forward cooldown (7 days)
            await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
            await ethers.provider.send("evm_mine", []);

            const shares = await env.vault.insBalanceOf(user1.address);
            await env.vault.connect(user1).unstakeInsurance(shares, receiver.address);

            const bal = await env.usdc.balanceOf(receiver.address);
            expect(bal).to.be.closeTo(assets, 1e7); // Account for DEAD_SHARES dilution (1%)
        });
    });

    describe("Exposure Update", function () {
        it("should update and cap exposure", async function () {
            const market = user1.address;
            const delta = ethers.parseUnits("1000", 18);

            const tradingAddr = await env.trading.getAddress();
            await env.vault.connect(admin).setTradingCore(tradingAddr);

            // Impersonate the real TradingCore to call updateExposure
            await ethers.provider.send("hardhat_impersonateAccount", [tradingAddr]);
            // Give it some ETH to pay for gas
            await ethers.provider.send("hardhat_setBalance", [tradingAddr, "0x1000000000000000000"]);

            const tradingSigner = await ethers.getSigner(tradingAddr);

            await env.vault.connect(tradingSigner).updateExposure(market, delta, true);

            await ethers.provider.send("hardhat_stopImpersonatingAccount", [tradingAddr]);
            const exposure = await env.vault.getMarketExposure(market);
            expect(exposure.longExposure).to.equal(delta);
        });
    });
});
