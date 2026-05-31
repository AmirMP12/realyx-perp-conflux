import { ethers } from "hardhat";

const libKey = (name: string) => `contracts/libraries/${name}.sol:${name}`;

/**
 * Deploy all libraries needed by the test harnesses and return a link map.
 * TradingLib itself links four sub-libraries, so we deploy those first.
 */
export async function deployAllLibraries(): Promise<Record<string, string>> {
    const deployLib = async (name: string, libs?: Record<string, string>) => {
        const factory = libs
            ? await ethers.getContractFactory(name, { libraries: libs })
            : await ethers.getContractFactory(name);
        const lib = await factory.deploy();
        await lib.waitForDeployment();
        return lib.getAddress();
    };

    const dividendSettlementLib = await deployLib("DividendSettlementLib");
    const fundingLib = await deployLib("FundingLib");
    const liquidationLib = await deployLib("LiquidationLib");
    const positionCloseLib = await deployLib("PositionCloseLib");

    const tradingLib = await deployLib("TradingLib", {
        [libKey("DividendSettlementLib")]: dividendSettlementLib,
        [libKey("FundingLib")]: fundingLib,
        [libKey("LiquidationLib")]: liquidationLib,
        [libKey("PositionCloseLib")]: positionCloseLib,
    });

    const globalPnLLib = await deployLib("GlobalPnLLib");
    // MonitoringLib links GlobalPnLLib + TradingLib.
    const monitoringLib = await deployLib("MonitoringLib", {
        [libKey("GlobalPnLLib")]: globalPnLLib,
        [libKey("TradingLib")]: tradingLib,
    });

    const map: Record<string, string> = {
        [libKey("DividendSettlementLib")]: dividendSettlementLib,
        [libKey("FundingLib")]: fundingLib,
        [libKey("LiquidationLib")]: liquidationLib,
        [libKey("PositionCloseLib")]: positionCloseLib,
        [libKey("TradingLib")]: tradingLib,
        [libKey("CleanupLib")]: await deployLib("CleanupLib"),
        [libKey("ConfigLib")]: await deployLib("ConfigLib"),
        [libKey("DustLib")]: await deployLib("DustLib"),
        [libKey("FlashLoanCheck")]: await deployLib("FlashLoanCheck"),
        [libKey("HealthLib")]: await deployLib("HealthLib"),
        [libKey("PositionTriggersLib")]: await deployLib("PositionTriggersLib"),
        [libKey("RateLimitLib")]: await deployLib("RateLimitLib"),
        [libKey("TradingContextLib")]: await deployLib("TradingContextLib"),
        [libKey("WithdrawLib")]: await deployLib("WithdrawLib"),
        [libKey("CollateralRouterLib")]: await deployLib("CollateralRouterLib"),
        [libKey("GlobalPnLLib")]: globalPnLLib,
        [libKey("MonitoringLib")]: monitoringLib,
        [libKey("CircuitBreakerLib")]: await deployLib("CircuitBreakerLib"),
        [libKey("OracleAggregatorLib")]: await deployLib("OracleAggregatorLib"),
    };
    return map;
}

/**
 * Deploy a harness contract, automatically linking only the libraries it needs.
 */
export async function deployHarness(name: string, libs: Record<string, string>, args: any[] = []) {
    // hardhat-ethers only requires the subset actually referenced; passing extra
    // links is rejected, so filter to the harness's own link references.
    const fs = require("fs");
    const path = require("path");
    const artifactPath = path.join(
        __dirname,
        "..",
        "..",
        "artifacts",
        "contracts",
        "test",
        `${name}.sol`,
        `${name}.json`,
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const needed: Record<string, string> = {};
    const refs = artifact.linkReferences || {};
    for (const file of Object.keys(refs)) {
        for (const libName of Object.keys(refs[file])) {
            const key = `${file}:${libName}`;
            if (libs[key]) needed[key] = libs[key];
        }
    }
    const factory = await ethers.getContractFactory(name, { libraries: needed });
    const c = await factory.deploy(...args);
    await c.waitForDeployment();
    return c;
}
