import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("TradingCore - Extended Coverage", function () {
    let env: any;
    let marketAddress: string;
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));

    beforeEach(async () => {
        env = await deployTestEnvironment();
        marketAddress = ethers.Wallet.createRandom().address;
        const feedId = ethers.hexlify(ethers.zeroPadValue(ethers.getBytes("0x01"), 32));
        
        await env.oracle.connect(env.admin).addSupportedMarket(marketAddress);
        await env.oracle.connect(env.admin).setPythFeed(marketAddress, feedId, 3600, 0);
        await env.trading.connect(env.admin).setMarket(
            marketAddress, marketAddress,
            100n, ethers.parseUnits("1000000", 6), ethers.parseUnits("5000000", 6), 500, 1000, 3600
        );

        await env.usdc.connect(env.admin).mintTo(env.alice.address, ethers.parseUnits("100000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        await env.usdc.connect(env.admin).mintTo(env.bob.address, ethers.parseUnits("500000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("200000", 6), env.bob.address);
        
        await env.vault.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
    });

    // ===== Market Config =====
    it("should allow admin to setMarket with valid params", async function () {
        const newMarket = ethers.Wallet.createRandom().address;
        const feedId = ethers.hexlify(ethers.zeroPadValue(ethers.getBytes("0x02"), 32));
        await env.oracle.connect(env.admin).addSupportedMarket(newMarket);
        await env.oracle.connect(env.admin).setPythFeed(newMarket, feedId, 3600, 0);
        
        await env.trading.connect(env.admin).setMarket(
            newMarket, newMarket,
            100n, ethers.parseUnits("500000", 6), ethers.parseUnits("2000000", 6), 300, 800, 1800
        );
    });

    // ===== setParams =====
    it("should persist params after setParams call", async function () {
        await env.trading.connect(env.admin).setParams(
            ethers.parseUnits("2", 18), 200, ethers.parseUnits("2", 18),
            ethers.parseUnits("2", 16), 10, 50, 200
        );
    });

    // ===== Revert on Invalid Orders =====
    it("should revert createOrder with zero size delta", async function () {
        await expect(
            env.trading.connect(env.alice).createOrder(
                1, marketAddress, 0, ethers.parseUnits("1000", 6), 0, true, 0, 0,
                { value: ethers.parseEther("0.001") }
            )
        ).to.be.reverted;
    });

    it("should revert createOrder for non-existent market", async function () {
        const fakeMarket = ethers.Wallet.createRandom().address;
        await expect(
            env.trading.connect(env.alice).createOrder(
                1, fakeMarket, ethers.parseUnits("5000", 6), ethers.parseUnits("1000", 6),
                0, true, 0, 0, { value: ethers.parseEther("0.001") }
            )
        ).to.be.reverted;
    });

    // ===== Liquidation Reverts =====
    it("should revert liquidatePosition for id 0", async function () {
        await expect(env.trading.connect(env.liquidator).liquidatePosition(0)).to.be.reverted;
    });

    it("should revert liquidatePosition for very large id", async function () {
        await expect(env.trading.connect(env.liquidator).liquidatePosition(999999)).to.be.reverted;
    });

    // ===== Execute Order Reverts =====
    it("should revert executeOrder for non-existent order", async function () {
        await expect(env.trading.connect(env.keeper).executeOrder(999, [])).to.be.reverted;
    });

    // ===== setContracts =====
    it("should allow admin to update contract references", async function () {
        await env.trading.connect(env.admin).setContracts(
            await env.vault.getAddress(),
            await env.oracle.getAddress(),
            await env.positionToken.getAddress()
        );
    });

    // ===== setRWAContracts =====
    it("should allow admin to update RWA contract references", async function () {
        await env.trading.connect(env.admin).setRWAContracts(
            await env.marketCalendar.getAddress(),
            await env.dividendManager.getAddress(),
            ethers.Wallet.createRandom().address
        );
    });
});
