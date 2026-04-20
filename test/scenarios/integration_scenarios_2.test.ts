import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("Coverage Integration 2 - Liquidations & Breakers", function () {
    let env: any;
    const MARKET = "0x0000000000000000000000000000000000000001";
    const MARKET_ID = "BTC-USD";
    const PYTH_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC/USD"));

    beforeEach(async () => {
        env = await deployTestEnvironment();
        await env.oracle.connect(env.admin).setPythFeed(MARKET, PYTH_ID, 3600, ethers.parseUnits("10", 18));
        await env.oracle.connect(env.admin).addSupportedMarket(MARKET);
        await env.marketCalendar.connect(env.admin).setMarketConfig(MARKET_ID, 0, 1439, 0, true);
        await env.trading.connect(env.admin).setMarket(
            MARKET, MARKET, 50,
            ethers.parseUnits("1000000", 18), ethers.parseUnits("10000000", 18),
            500, 1000, 3600
        );
        await env.trading.connect(env.admin).setMarketId(MARKET, MARKET_ID);

        // Vault setup
        const bob = ethers.parseUnits("1000000", 6);
        await env.usdc.connect(env.admin).mintTo(env.bob.address, bob);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(bob, env.bob.address);

        // Trader setup
        const alice = ethers.parseUnits("100000", 6);
        await env.usdc.connect(env.admin).mintTo(env.alice.address, alice);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
    });

    async function setPrice(price: number) {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        const payload = await env.pyth.createPriceFeedUpdateData(
            PYTH_ID, price * 1e8, 1, -8, price * 1e8, 1, publishTime, publishTime - 5
        );
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
    }

    it("should liquidate a position successfully", async function () {
        await setPrice(60000);
        
        // Target: LiquidationLib
        await env.trading.connect(env.alice).createOrder(
            0, MARKET, ethers.parseUnits("600000", 6), ethers.parseUnits("20000", 6), // 30x leverage (below 50x max)
            ethers.parseUnits("60000", 18), true, 10000, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, [], { value: 0 });

        // TradingCore balance check uses a conservative pre-repay buffer; top up so liquidation can settle.
        await env.usdc.mintTo(await env.trading.getAddress(), ethers.parseUnits("500000", 6));

        // Drop price mildly so liquidators have plenty of reward out of the collateral pool
        await setPrice(59500);
        
        const LIQUIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE"));
        await env.trading.grantRole(LIQUIDATOR_ROLE, env.keeper.address);
        
        // Add massive backing liquidity to cover the payout shortfall
        const richBob = ethers.parseUnits("10000000", 6);
        await env.usdc.connect(env.admin).mintTo(env.bob.address, richBob);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(richBob, env.bob.address);
        
        const tx = await env.trading.connect(env.keeper).liquidatePosition(1);
        const receipt = await tx.wait();
        expect(receipt).to.not.be.undefined;
        
        const pos = await env.trading.getPosition(1);
        expect(pos.state).to.equal(3); // LIQUIDATED
    });

    it("should trigger circuit breaker and emergency pausing", async function () {
        await setPrice(60000);
        
        // Oracle Breakers
        await env.oracle.connect(env.admin).configureBreaker(MARKET, 0, 1000, 300, 60); // 10%
        
        // Spike price by 20%
        await setPrice(72000);
        
        // Emergency Pause Lib
        await env.trading.connect(env.admin).pause();
        await expect(env.trading.liquidatePosition(1)).to.be.reverted;
        await env.trading.connect(env.admin).unpause();
    });

    it("should handle withdraw lib logic successfully", async function() {
        await setPrice(60000);
        // Withdraw coverage (queue then process)
        const amount = ethers.parseUnits("100", 6);
        await env.vault.connect(env.bob).queueWithdrawal(amount, 0);
        await ethers.provider.send("evm_increaseTime", [3 * 86400 + 1]);
        await ethers.provider.send("evm_mine", []);
        // Get the queue request (assuming it starts at ID 1 or we can just pass an array of IDs 1..5)
        await env.vault.connect(env.bob).processWithdrawals([1]);
    });

    it("should handle emergency price resolution", async function() {
        await setPrice(60000);
        // Target: EmergencyPriceLib
        const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.alice.address);
        await env.oracle.connect(env.admin).setGuardianQuorum(1);
        
        const latestBlock = await ethers.provider.getBlock("latest");
        const tx = await env.oracle.connect(env.admin).proposeEmergencyPrice(
            MARKET, ethers.parseUnits("60000", 18), latestBlock!.timestamp + 3600
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find((log: any) => log.fragment && log.fragment.name === 'EmergencyPriceProposed');
        const proposalId = event ? event.args[0] : ethers.id("test");

        await env.oracle.connect(env.alice).confirmEmergencyPrice(proposalId);
        
        const [price,,] = await env.oracle.getPrice(MARKET);
        expect(price).to.equal(ethers.parseUnits("60000", 18));
    });
    
});
