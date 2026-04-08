import { ethers } from "hardhat";
import type { ContractFactory } from "ethers";

/** Linked factories for UUPS upgrade tests (same wiring as deployTestEnvironment). */
export async function getTradingCoreLinkedFactory(): Promise<ContractFactory> {
    const deployLib = async (name: string) => (await (await ethers.getContractFactory(name)).deploy()).getAddress();

    const divSettlement = await deployLib("DividendSettlementLib");
    const fundLib = await deployLib("FundingLib");
    const liqLib = await deployLib("LiquidationLib");
    const posCloseLib = await deployLib("PositionCloseLib");
    const cleanupLib = await deployLib("CleanupLib");
    const configLib = await deployLib("ConfigLib");
    const dustLib = await deployLib("DustLib");
    const flashLib = await deployLib("FlashLoanCheck");
    const healthLib = await deployLib("HealthLib");
    const posTriggersLib = await deployLib("PositionTriggersLib");
    const tradeCtxLib = await deployLib("TradingContextLib");
    const withdrawLib = await deployLib("WithdrawLib");
    const rateLimitLib = await deployLib("RateLimitLib");
    const TradingLib = await ethers.getContractFactory("TradingLib", {
        libraries: {
            "contracts/libraries/DividendSettlementLib.sol:DividendSettlementLib": divSettlement,
            "contracts/libraries/FundingLib.sol:FundingLib": fundLib,
            "contracts/libraries/LiquidationLib.sol:LiquidationLib": liqLib,
            "contracts/libraries/PositionCloseLib.sol:PositionCloseLib": posCloseLib,
        },
    });
    const tradingLib = await (await TradingLib.deploy()).getAddress();

    return ethers.getContractFactory("TradingCore", {
        libraries: {
            "contracts/libraries/CleanupLib.sol:CleanupLib": cleanupLib,
            "contracts/libraries/ConfigLib.sol:ConfigLib": configLib,
            "contracts/libraries/DustLib.sol:DustLib": dustLib,
            "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": flashLib,
            "contracts/libraries/FundingLib.sol:FundingLib": fundLib,
            "contracts/libraries/HealthLib.sol:HealthLib": healthLib,
            "contracts/libraries/PositionTriggersLib.sol:PositionTriggersLib": posTriggersLib,
            "contracts/libraries/TradingContextLib.sol:TradingContextLib": tradeCtxLib,
            "contracts/libraries/TradingLib.sol:TradingLib": tradingLib,
            "contracts/libraries/WithdrawLib.sol:WithdrawLib": withdrawLib,
            "contracts/libraries/RateLimitLib.sol:RateLimitLib": rateLimitLib,
        },
    });
}

export async function getOracleLinkedFactory(): Promise<ContractFactory> {
    // OracleAggregator no longer uses externally-linked libs; it inlines logic.
    return ethers.getContractFactory("OracleAggregator");
}

export async function deployTestEnvironment() {
    const [admin, alice, bob, liquidator, treasury, keeper] = await ethers.getSigners();
    
    console.log("Mocking USDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    console.log("MockUSDC deployed at:", usdc.target);
    
    console.log("Searching for MockPyth factory...");
    const MockPyth = await ethers.getContractFactory("MockPyth");
    console.log("Deploying MockPyth...");
    const pyth = await MockPyth.deploy(3600, 0);
    console.log("MockPyth deployed at:", pyth.target);

    // Deploy contracts
    console.log("Deploying MarketCalendar...");
    const MarketCalendar = await ethers.getContractFactory("MarketCalendar");
    const marketCalendar = await MarketCalendar.deploy();
    await marketCalendar.initialize(admin.address);
    
    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dividendManager = await DividendManager.deploy();
    await dividendManager.initialize(admin.address);
    
    const ComplianceManager = await ethers.getContractFactory("AllowListCompliance");
    const complianceManager = await ComplianceManager.deploy();
    await complianceManager.initialize(admin.address);
    
    // Deploy libs used by some coverage harnesses/tests (even if OracleAggregator no longer links them)
    const CircuitBreakerLib = await (await ethers.getContractFactory("CircuitBreakerLib")).deploy();
    const EmergencyPauseLib = await (await ethers.getContractFactory("EmergencyPauseLib")).deploy();
    const EmergencyPriceLib = await (await ethers.getContractFactory("EmergencyPriceLib")).deploy();
    const GlobalPnLLib = await (await ethers.getContractFactory("GlobalPnLLib")).deploy();
    
    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    const oracle = await OracleAggregator.deploy();
    await oracle.initialize(admin.address, await pyth.getAddress());

    // Deploy Vault
    const VaultCore = await ethers.getContractFactory("VaultCore");
    const vault = await VaultCore.deploy();
    await vault.initialize(admin.address, await usdc.getAddress(), treasury.address);

    // Deploy PositionToken
    const PositionToken = await ethers.getContractFactory("PositionToken");
    const positionToken = await PositionToken.deploy();
    await positionToken.initialize("RWA", "RWAP", "");

    // Deploy Trading Libs
    const deployLib = async (name: string) => (await (await ethers.getContractFactory(name)).deploy()).getAddress();
    
    const divSettlement = await deployLib("DividendSettlementLib");
    const fundLib = await deployLib("FundingLib");
    const liqLib = await deployLib("LiquidationLib");
    const posCloseLib = await deployLib("PositionCloseLib");
    const cleanupLib = await deployLib("CleanupLib");
    const configLib = await deployLib("ConfigLib");
    const dustLib = await deployLib("DustLib");
    const flashLib = await deployLib("FlashLoanCheck");
    const healthLib = await deployLib("HealthLib");
    const posMathLib = await deployLib("PositionMath");
    const posTriggersLib = await deployLib("PositionTriggersLib");
    const tradeCtxLib = await deployLib("TradingContextLib");
    const withdrawLib = await deployLib("WithdrawLib");
    const rateLimitLib = await deployLib("RateLimitLib");
    const TradingLib = await ethers.getContractFactory("TradingLib", {
        libraries: {
            "contracts/libraries/DividendSettlementLib.sol:DividendSettlementLib": divSettlement,
            "contracts/libraries/FundingLib.sol:FundingLib": fundLib,
            "contracts/libraries/LiquidationLib.sol:LiquidationLib": liqLib,
            "contracts/libraries/PositionCloseLib.sol:PositionCloseLib": posCloseLib,
        }
    });
    const tradingLib = await (await TradingLib.deploy()).getAddress();

    const MonitoringLib = await ethers.getContractFactory("MonitoringLib", {
        libraries: {
            "contracts/libraries/GlobalPnLLib.sol:GlobalPnLLib": await GlobalPnLLib.getAddress(),
            "contracts/libraries/TradingLib.sol:TradingLib": tradingLib,
        }
    });
    const monitoringLib = await (await MonitoringLib.deploy()).getAddress();

    const TradingCore = await ethers.getContractFactory("TradingCore", {
        libraries: {
            "contracts/libraries/CleanupLib.sol:CleanupLib": cleanupLib,
            "contracts/libraries/ConfigLib.sol:ConfigLib": configLib,
            "contracts/libraries/DustLib.sol:DustLib": dustLib,
            "contracts/libraries/FlashLoanCheck.sol:FlashLoanCheck": flashLib,
            "contracts/libraries/FundingLib.sol:FundingLib": fundLib,
            "contracts/libraries/HealthLib.sol:HealthLib": healthLib,
            "contracts/libraries/PositionTriggersLib.sol:PositionTriggersLib": posTriggersLib,
            "contracts/libraries/TradingContextLib.sol:TradingContextLib": tradeCtxLib,
            "contracts/libraries/TradingLib.sol:TradingLib": tradingLib,
            "contracts/libraries/WithdrawLib.sol:WithdrawLib": withdrawLib,
            "contracts/libraries/RateLimitLib.sol:RateLimitLib": rateLimitLib,
        }
    });
    
    const trading = await TradingCore.deploy();
    await trading.initialize(admin.address, await usdc.getAddress(), treasury.address);

    // Wiring
    await vault.setTradingCore(await trading.getAddress());
    await positionToken.setTradingCore(await trading.getAddress());
    await trading.setContracts(await vault.getAddress(), await oracle.getAddress(), await positionToken.getAddress());
    await trading.setRWAContracts(await marketCalendar.getAddress(), await dividendManager.getAddress(), await complianceManager.getAddress());
    
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
    const LIQUIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LIQUIDATOR_ROLE"));
    
    await oracle.grantRole(OPERATOR_ROLE, admin.address);
    await trading.grantRole(OPERATOR_ROLE, admin.address);
    await trading.grantRole(KEEPER_ROLE, keeper.address);
    await trading.grantRole(LIQUIDATOR_ROLE, liquidator.address);
    await oracle.registerPausable(await trading.getAddress());
    await oracle.registerPausable(await vault.getAddress());

    // Whitelist all test users in compliance
    await (complianceManager as any).batchSetWhitelist(
        [admin.address, alice.address, bob.address, liquidator.address, keeper.address, treasury.address],
        true
    );

    // Wire DividendManager to TradingCore
    await dividendManager.setTradingCore(await trading.getAddress());

    return { 
        admin, alice, bob, liquidator, treasury, keeper,
        usdc, pyth, oracle, vault, trading, positionToken, marketCalendar, dividendManager, complianceManager,
        libs: { 
            posMathLib, 
            tradingLib, 
            cleanupLib,
            configLib,
            dustLib,
            flashLib,
            withdrawLib,
            monitoringLib,
            rateLimitLib,
            feeLib: await deployLib("FeeCalculator"),
            fundingLib: fundLib,
            liqLib: liqLib,
            posTriggersLib,
            globalPnLLib: await GlobalPnLLib.getAddress(),
            circuitBreakerLib: await CircuitBreakerLib.getAddress(),
            emergencyPauseLib: await EmergencyPauseLib.getAddress(),
            emergencyPriceLib: await EmergencyPriceLib.getAddress(),
        }
    };
}
