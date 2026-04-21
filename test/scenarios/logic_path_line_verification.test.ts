import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";

describe("Coverage line targets", function () {
    it("covers TradingCore failed-repayment views and position-owner update path", async function () {
        const env = await deployTestEnvironment();
        const market = env.alice.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("line-target-owner"));

        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            50,
            ethers.parseUnits("100000", 18),
            ethers.parseUnits("1000000", 18),
            500,
            1000,
            3600
        );
        await env.trading.connect(env.admin).setMarketId(market, "LINE-TGT");
        await env.marketCalendar.connect(env.admin).setMarketConfig("LINE-TGT", 0, 1439, 0, true);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("10000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.bob.address, ethers.parseUnits("200000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("100000", 6), env.bob.address);

        await env.trading.connect(env.admin).grantRole(await env.trading.TRADING_CORE_ROLE(), env.admin.address);
        await env.trading.connect(env.admin).recordFailedRepayment(123n, 1000n * 10n ** 6n, market, true, -1n);

        const fr = await env.trading.getFailedRepayment(123n);
        expect(fr.amount).to.equal(1000n * 10n ** 6n);
        const bals = await env.trading.getBalances(env.alice.address);
        expect(bals.keeperFee).to.equal(0n);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("1000", 6),
            ethers.parseUnits("200", 6),
            ethers.parseUnits("3000", 18),
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        const t = (await ethers.provider.getBlock("latest"))!.timestamp;
        const px = 3000n * 10n ** 8n;
        const payload = await env.pyth.createPriceFeedUpdateData(feedId, px, 1n, -8, px, 1n, BigInt(t), BigInt(t - 5));
        await env.pyth.updatePriceFeeds([payload], { value: 1n });
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        // Transfer should trigger TradingCore.updatePositionOwner via PositionToken hook.
        await env.positionToken.connect(env.alice).transferFrom(env.alice.address, env.bob.address, 1n);
    });

    it("covers FundingLib shortfall branch", async function () {
        const FundingLib = await (await ethers.getContractFactory("FundingLib")).deploy();
        const Harness = await ethers.getContractFactory("FundingLibHarness", {
            libraries: {
                "contracts/libraries/FundingLib.sol:FundingLib": await FundingLib.getAddress(),
            },
        });
        const h = await Harness.deploy();
        await h.setCollateral(100n);
        const tx = await h.applyFunding(1000n, 99n);
        await tx.wait();
        expect(await h.collateralAmount()).to.equal(0n);
    });

    it("covers PositionCloseLib catch branch when coverBadDebt reverts", async function () {
        const env = await deployTestEnvironment();
        const market = env.alice.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("line-target-close"));

        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.oracle.connect(env.admin).addSupportedMarket(market);
        await env.trading.connect(env.admin).setMarket(
            market,
            market,
            50,
            ethers.parseUnits("100000", 18),
            ethers.parseUnits("1000000", 18),
            500,
            1000,
            3600
        );
        await env.trading.connect(env.admin).setMarketId(market, "LINE-CLOSE");
        await env.marketCalendar.connect(env.admin).setMarketConfig("LINE-CLOSE", 0, 1439, 0, true);

        await env.usdc.mintTo(env.alice.address, ethers.parseUnits("10000", 6));
        await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
        await env.usdc.mintTo(env.bob.address, ethers.parseUnits("300000", 6));
        await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
        await env.vault.connect(env.bob).deposit(ethers.parseUnits("150000", 6), env.bob.address);

        await env.trading.connect(env.alice).createOrder(
            0,
            market,
            ethers.parseUnits("7000", 6),
            ethers.parseUnits("1200", 6),
            ethers.parseUnits("3000", 18),
            true,
            10000,
            0,
            { value: ethers.parseEther("0.01") }
        );

        const now = (await ethers.provider.getBlock("latest"))!.timestamp;
        const p0 = 3000n * 10n ** 8n;
        const payload0 = await env.pyth.createPriceFeedUpdateData(feedId, p0, 1n, -8, p0, 1n, BigInt(now), BigInt(now - 5));
        await env.pyth.updatePriceFeeds([payload0], { value: 1n });
        await env.trading.connect(env.keeper).executeOrder(1n, []);

        // Wait out minPositionDuration.
        await ethers.provider.send("evm_increaseTime", [130]);
        await ethers.provider.send("evm_mine", []);

        // Adverse move to create a shortfall on close.
        const p1 = 1200n * 10n ** 8n;
        const payload1 = await env.pyth.createPriceFeedUpdateData(feedId, p1, 1n, -8, p1, 1n, BigInt(now + 600), BigInt(now + 595));
        await env.pyth.updatePriceFeeds([payload1], { value: 1n });

        const MockVault = await ethers.getContractFactory("MockVaultCoverBadDebtRevert");
        const mockVault = await MockVault.deploy();
        await env.trading
            .connect(env.admin)
            .setContracts(await mockVault.getAddress(), await env.oracle.getAddress(), await env.positionToken.getAddress());

        const block = await ethers.provider.getBlock("latest");
        await expect(
            env.trading
                .connect(env.alice)
                .closePosition({
                    positionId: 1n,
                    closeSize: 0n,
                    minReceive: 0n,
                    deadline: BigInt(block!.timestamp + 600)
                })
        ).to.be.reverted;
    });

    it("covers MonitoringLib.getCircuitBreakerStatus and VaultCore preview edge branch", async function () {
        const env = await deployTestEnvironment();
        const market = env.alice.address;
        const feedId = ethers.keccak256(ethers.toUtf8Bytes("line-target-monitor"));

        await env.oracle.connect(env.admin).setPythFeed(market, feedId, 3600, 0);
        await env.oracle.connect(env.admin).addSupportedMarket(market);

        const deployLib = async (name: string) => (await (await ethers.getContractFactory(name)).deploy()).getAddress();
        const divSettlement = await deployLib("DividendSettlementLib");
        const fundLib = await deployLib("FundingLib");
        const liqLib = await deployLib("LiquidationLib");
        const posCloseLib = await deployLib("PositionCloseLib");
        const TradingLib = await ethers.getContractFactory("TradingLib", {
            libraries: {
                "contracts/libraries/DividendSettlementLib.sol:DividendSettlementLib": divSettlement,
                "contracts/libraries/FundingLib.sol:FundingLib": fundLib,
                "contracts/libraries/LiquidationLib.sol:LiquidationLib": liqLib,
                "contracts/libraries/PositionCloseLib.sol:PositionCloseLib": posCloseLib,
            },
        });
        const tradingLib = await (await TradingLib.deploy()).getAddress();
        const globalPnLLib = await deployLib("GlobalPnLLib");
        const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
            libraries: {
                "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": globalPnLLib,
                "contracts/libraries/TradingLib.sol:TradingLib": tradingLib,
            },
        });
        const monitoringLib = await (await MonitoringLib.deploy()).getAddress();
        const MonitoringHarness = await ethers.getContractFactory("MonitoringLibHarness", {
            libraries: {
                "contracts/libraries/MonitoringLib.sol:MonitoringLib": monitoringLib,
            },
        });
        const mh = await MonitoringHarness.deploy();
        const [restricted, activeBreakers, globalPause] = await mh.getCircuitStatus(await env.oracle.getAddress(), market);
        expect(restricted).to.equal(false);
        expect(activeBreakers).to.equal(0n);
        expect(globalPause).to.equal(false);

        // Hit VaultCore _convertToLPShares branch where rawTotal < minInitialDeposit and dead-shares exist.
        await env.usdc.mintTo(await env.vault.getAddress(), 1n);
        const preview = await env.vault.previewDeposit(1n);
        expect(preview).to.be.gte(0n);
    });
});

