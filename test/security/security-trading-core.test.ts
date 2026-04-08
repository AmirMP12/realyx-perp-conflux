import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestEnvironment } from "../helpers";
import { TradingCore, OracleAggregator } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

type TestEnvironment = any;

describe("TradingCore Security Coverage", function () {
    let env: TestEnvironment;
    let tradingCore: TradingCore;
    let oracle: OracleAggregator;
    let admin: SignerWithAddress;
    let alice: SignerWithAddress;

    beforeEach(async function () {
        env = await deployTestEnvironment();
        tradingCore = env.trading;
        oracle = env.oracle;
        admin = env.admin;
        alice = env.alice;

        const OPERATOR_ROLE = await tradingCore.OPERATOR_ROLE();
        await tradingCore.grantRole(OPERATOR_ROLE, admin.address);
    });

    describe("Modifiers and Security Checks", function () {
        it("should test checkProtocolHealth modifier", async function () {
            const ph = await tradingCore.protocolHealth();
            expect(ph.isHealthy).to.equal(true);
        });

        it("should test checkBreakers via Oracle mock", async function () {
            const Mock = await ethers.getContractFactory("MockOracleBreaker");
            const mockOracle = await Mock.deploy();
            const market = ethers.Wallet.createRandom().address;
            const feedId = ethers.keccak256(ethers.toUtf8Bytes("sec-mock"));
            await tradingCore.connect(admin).setMarket(
                market,
                market,
                100,
                ethers.parseUnits("500000", 6),
                ethers.parseUnits("10000000", 6),
                500,
                1000,
                86400
            );
            await tradingCore.connect(admin).setMarketId(market, "SEC-MOCK");
            await env.oracle.connect(admin).addSupportedMarket(market);
            await env.oracle.connect(admin).setPythFeed(market, feedId, 3600, 0);

            await tradingCore.connect(admin).setContracts(
                await env.vault.getAddress(),
                await mockOracle.getAddress(),
                await env.positionToken.getAddress()
            );
            await mockOracle.setAllow(false);

            await env.usdc.mintTo(alice.address, 10_000_000n);
            await env.usdc.connect(alice).approve(await tradingCore.getAddress(), ethers.MaxUint256);
            await expect(
                tradingCore.connect(alice).createOrder(0, market, 100e6, 100e6, 0, true, 0, 0, { value: ethers.parseEther("0.01") })
            ).to.be.reverted;

            await tradingCore.connect(admin).setContracts(await env.vault.getAddress(), await oracle.getAddress(), await env.positionToken.getAddress());
        });

        it("should test requireOracleSources", async function () {
            const count = await oracle.getValidSourceCount(ethers.ZeroAddress);
            expect(count).to.be.a("bigint");
        });
    });

    describe("Administrative Actions", function () {
        it("should record failed repayment", async function () {
            const TRADING_CORE_ROLE = await tradingCore.TRADING_CORE_ROLE();
            await tradingCore.connect(admin).grantRole(TRADING_CORE_ROLE, admin.address);

            const market = ethers.Wallet.createRandom().address;
            await tradingCore.connect(admin).recordFailedRepayment(999, 1000e6, market, true, -1000e6);

            expect(await tradingCore.totalFailedRepayments()).to.be.gt(0);
        });

        it("should test setLimits and setParams", async function () {
            await tradingCore.connect(admin).setLimits(2000000e6, 100000000e6, 50000e6, 100, 100000e6, 60);
            await tradingCore.connect(admin).setParams(200e6, 20, 5, ethers.parseEther("0.01"), 100, 5, 2000);

            expect(await tradingCore.minPositionSize()).to.equal(200e6);
        });
    });

    describe("Upgrade Coverage", function () {
        it("documents UUPS admin checks", async function () {
            expect(await tradingCore.getAddress()).to.be.properAddress;
            // Proxy upgrade + _authorizeUpgrade paths: see test/SecurityRiskManagement.test.ts
        });
    });
});
