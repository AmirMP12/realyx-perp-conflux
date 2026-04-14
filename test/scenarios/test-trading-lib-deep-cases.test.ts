import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Deep Branch Coverage - TradingLib Explosion", function () {
    async function deployCoverageFixture() {
        const env = await deployTestEnvironment();
        
        const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
            libraries: {
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
            }
        });
        const monitoringLib = await MonitoringLib.deploy();

        const CoverageHarness = await ethers.getContractFactory("CoverageHarness", {
            libraries: {
                "contracts/libraries/TradingLib.sol:TradingLib": env.libs.tradingLib,
                "contracts/libraries/MonitoringLib.sol:MonitoringLib": await monitoringLib.getAddress(),
                "contracts/libraries/CleanupLib.sol:CleanupLib": env.libs.cleanupLib,
                "contracts/libraries/ConfigLib.sol:ConfigLib": env.libs.configLib,
                "contracts/libraries/DustLib.sol:DustLib": env.libs.dustLib,
                "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": env.libs.flashLib,
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": env.libs.globalPnLLib,
                "contracts/libraries/RateLimitLib.sol:RateLimitLib": env.libs.rateLimitLib,
                "contracts/libraries/WithdrawLib.sol:WithdrawLib": env.libs.withdrawLib,
            }
        });
        const harness = await CoverageHarness.deploy();

        return { env, harness };
    }

    it("exercises TradingLib.cancelOrder: All Branches", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        const [admin, user] = await ethers.getSigners();
        
        const orderId = 123;
        
        // 1. OrderNotFound (Account is 0)
        await expect(harness.boostCancelOrder(orderId, ethers.ZeroAddress, admin.address, 0, 0, 0))
            .to.be.reverted;

        // 2. Unauthorized (Account is not msgSender)
        await expect(harness.boostCancelOrder(orderId, user.address, admin.address, 0, 0, 0))
            .to.be.reverted;

        // 3. Success - Market Increase with collateral
        // orderTypes: 0=MARKET_INCREASE
        await harness.boostCancelOrder(orderId, admin.address, admin.address, 1000n, 0, 500n);
        expect(await harness.orderRefundBalance(admin.address)).to.equal(500n);
        expect(await harness.orderCollateralRefundBalance(admin.address)).to.equal(1000n);

        // 4. Success - Market Decrease (no collateral refund branch)
        // 1=MARKET_DECREASE
        await harness.boostCancelOrder(orderId + 1, admin.address, admin.address, 1000n, 1, 300n);
    });

    it("exercises TradingLib.applyLiquidatePostProcess: All Branches", async function () {
        const { harness } = await loadFixture(deployCoverageFixture);
        
        // 1. didRecordFailed = false
        const [r1, b1] = await harness.boostApplyLiquidatePostProcess.staticCall(1, false, 1000n, 500n, 10);
        expect(r1).to.equal(10n);
        expect(b1).to.equal(1000n);

        // 2. didRecordFailed = true, failedAmount = 0
        const [r2, b2] = await harness.boostApplyLiquidatePostProcess.staticCall(2, true, 1000n, 0n, 10);
        expect(r2).to.equal(10n);

        // 3. didRecordFailed = true, failedAmount > 0 (Trigger bad debt update)
        const [r3, b3] = await harness.boostApplyLiquidatePostProcess.staticCall(3, true, 1000n, 500n, 10);
        expect(r3).to.equal(11n);
        expect(b3).to.be.above(1000n);
    });
});
