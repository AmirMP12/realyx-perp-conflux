import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("Coverage Integration 3 - Views & Pure Functions", function () {
    let env: any;
    const MARKET = "0x0000000000000000000000000000000000000001";
    const MARKET_ID = "BTC-USD";
    const PYTH_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC/USD"));
    let views: any;

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
        const bob = ethers.parseUnits("10000000", 6);
        await env.usdc.connect(env.admin).mintTo(env.bob.address, bob);
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(bob, env.bob.address);

        // Trader setup
        const alice = ethers.parseUnits("100000", 6);
        await env.usdc.connect(env.admin).mintTo(env.alice.address, alice);
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);

        // Deploy TradingCoreViews
        const Views = await ethers.getContractFactory("TradingCoreViews");
        views = await Views.deploy();
        await views.waitForDeployment();
        await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());
        
        const VAULT_CORE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VAULT_CORE_ROLE"));
        await env.trading.connect(env.admin).grantRole(VAULT_CORE_ROLE, await views.getAddress());
        await env.trading.connect(env.admin).setTradingViews(await views.getAddress());
        
        // Oracle setup
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        const payload = await env.pyth.createPriceFeedUpdateData(
            PYTH_ID, 60000 * 1e8, 1, -8, 60000 * 1e8, 1, publishTime, publishTime - 5
        );
        await env.pyth.updatePriceFeeds([payload], { value: 1 });
    });

    it("should successfully run all view functions perfectly", async function() {
        // Run against empty state
        const health = await views.getProtocolHealth();
        expect(health.isHealthy).to.be.true;

        const circuit = await views.getCircuitBreakerStatus(MARKET);
        expect(circuit.isRestricted).to.be.false;

        const pnl = await views.getGlobalUnrealizedPnL(await env.trading.getAddress());
        expect(pnl).to.equal(0);

        // Run against open position
        await env.trading.connect(env.alice).createOrder(
            0, MARKET, ethers.parseUnits("20000", 6), ethers.parseUnits("5000", 6),
            ethers.parseUnits("60000", 18), true, 2000, 0,
            { value: ethers.parseEther("0.01") }
        );
        await env.trading.connect(env.keeper).executeOrder(1, [], { value: 0 });

        const posHealth = await views.getPositionHealth(1);
        expect(posHealth.isLiquidatable).to.be.false;

        const posPnl = await views.getPositionPnL(await env.trading.getAddress(), 1);
        expect(posPnl.pnl).to.equal(0);

        const canLiq = await views.canLiquidate(await env.trading.getAddress(), 1);
        expect(canLiq[0]).to.be.false;

        const pnlAfter = await views.getGlobalUnrealizedPnL(await env.trading.getAddress());
        expect(pnlAfter).to.equal(0);
    });
});
