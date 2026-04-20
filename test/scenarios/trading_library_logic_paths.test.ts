import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployTestEnvironment } from "../helpers";

describe("Trading Library Logic Path Scenarios", function () {
    async function deployFixture() {
        const env = await deployTestEnvironment();
        const ORACLE_ROLE = ethers.id("ORACLE_ROLE");
        const KEEPER_ROLE = ethers.id("KEEPER_ROLE");
        const GUARDIAN_ROLE = ethers.id("GUARDIAN_ROLE");
        const OPERATOR_ROLE = ethers.id("OPERATOR_ROLE");

        await env.oracle.grantRole(ORACLE_ROLE, env.admin.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.admin.address);
        await env.oracle.grantRole(GUARDIAN_ROLE, env.bob.address);
        await env.trading.grantRole(KEEPER_ROLE, env.admin.address);
        await env.trading.grantRole(OPERATOR_ROLE, env.admin.address);
        return env;
    }

    it("hits withdrawCollateral price 0 branch through TradingCore", async function () {
        const env = await loadFixture(deployFixture);
        const { admin, alice, trading, oracle, usdc } = env;
        
        const market = ethers.Wallet.createRandom().address;
        const feedId = ethers.encodeBytes32String("test_feed_4");
        
        // 1. Setup Oracle
        await oracle.addSupportedMarket(market);
        await oracle.setPythFeed(market, feedId, 3600, 0);
        
        // 2. Setup Market in TradingCore
        await trading.setMarket(
            market, market, 50, 1e12, 1e12, 500, 1000, 3600
        );
        
        const pyth = await ethers.getContractAt("MockPyth", await oracle.pyth());
        const updateData = await pyth.createPriceFeedUpdateData(
            feedId, 100 * 1e8, 1e6, -8, 100 * 1e8, 1e6, await time.latest(), (await time.latest()) - 60
        );
        await pyth.updatePriceFeeds([updateData]);

        // Seed vault liquidity so order execution can open the position.
        await usdc.mintTo(admin.address, 2_000_000e6);
        await usdc.connect(admin).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(admin).deposit(1_000_000e6, admin.address);
        await env.vault.connect(admin).stakeInsurance(1_000_000e6, admin.address);

        await usdc.mintTo(alice.address, ethers.parseUnits("1000", 6));
        await usdc.connect(alice).approve(await trading.getAddress(), ethers.MaxUint256);
        
        const txCreate = await trading.connect(alice).createOrder(
            0, market, ethers.parseUnits("1000", 6), ethers.parseUnits("200", 6),
            0, true, 500, 0, { value: ethers.parseEther("0.1") }
        );
        const recCreate = await txCreate.wait();
        const orderCreatedLog = recCreate?.logs.find((l: any) => {
            try { return trading.interface.parseLog(l)?.name === "OrderCreated"; } catch(e) { return false; }
        });
        const orderId = trading.interface.parseLog(orderCreatedLog!).args.orderId;

        await trading.executeOrder(orderId, []);
        
        const now = await time.latest();
        const zeroPriceUpdate = await pyth.createPriceFeedUpdateData(
            feedId, 0, 1e6, -8, 0, 1e6, now, now
        );
        await pyth.updatePriceFeeds([zeroPriceUpdate]);
        
        await expect(trading.connect(alice).withdrawCollateral(1, 10)).to.be.reverted;
    });

    it("hits resolveFailedRepayment branches through Harness", async function () {
        const env = await loadFixture(deployFixture);
        const harness = await (await ethers.getContractFactory("CoverageHarness", {
            libraries: {
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
                "contracts/libraries/MonitoringLib.sol:MonitoringLib": env.libs.monitoringLib,
                "contracts/libraries/CleanupLib.sol:CleanupLib": env.libs.cleanupLib,
                "contracts/libraries/ConfigLib.sol:ConfigLib": env.libs.configLib,
                "contracts/libraries/DustLib.sol:DustLib": env.libs.dustLib,
                "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": env.libs.flashLib,
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/RateLimitLib.sol:RateLimitLib": env.libs.rateLimitLib,
                "contracts/libraries/WithdrawLib.sol:WithdrawLib": env.libs.withdrawLib,
            }
        })).deploy();

        await harness.setFailedRepayment(123, {
            amount: 100, market: env.alice.address, isLong: true, pnl: 50, timestamp: await time.latest(), resolved: false
        });

        const mockVault = await (await ethers.getContractFactory("MockVaultRevertingRepay")).deploy();
        await env.usdc.mintTo(env.alice.address, 1000);
        await env.usdc.connect(env.alice).approve(await harness.getAddress(), ethers.MaxUint256);

        await expect(harness.testResolveFailedRepayment(
            123, env.alice.address, await env.usdc.getAddress(), await mockVault.getAddress()
        )).to.be.revertedWithCustomError({ interface: (await ethers.getContractAt("TradingLib", ethers.ZeroAddress)).interface }, "RepaymentValidationFailed");
    });
});
