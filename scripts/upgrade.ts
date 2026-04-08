import { ethers, upgrades } from "hardhat";
import { requireEnv } from "./helpers";

/**
 * Generic UUPS upgrade script.
 * Supports linked-library contracts (TradingCore, OracleAggregator, TradingCoreViews).
 *
 * Required env:
 *   CONTRACT_TO_UPGRADE  – Factory name, e.g. "TradingCore"
 *   PROXY_ADDRESS         – The proxy to upgrade
 *
 * For linked-library contracts, also set the deployed library addresses:
 *   LIB_TRADING_LIB, LIB_CLEANUP_LIB, LIB_CONFIG_LIB, LIB_DUST_LIB,
 *   LIB_FLASH_LOAN_CHECK, LIB_FUNDING_LIB, LIB_HEALTH_LIB,
 *   LIB_POSITION_TRIGGERS_LIB, LIB_TRADING_CONTEXT_LIB, LIB_WITHDRAW_LIB,
 *   LIB_CIRCUIT_BREAKER_LIB, LIB_EMERGENCY_PAUSE_LIB, LIB_EMERGENCY_PRICE_LIB,
 *   LIB_POSITION_MATH
 */
const libAddr = (name: string) => `contracts/libraries/${name}.sol:${name}`;

function getLibraryLinks(contractName: string): Record<string, string> {
    if (contractName === "TradingCore") {
        const required = [
            "CleanupLib",
            "ConfigLib",
            "DustLib",
            "FlashLoanCheck",
            "FundingLib",
            "HealthLib",
            "PositionTriggersLib",
            "TradingContextLib",
            "TradingLib",
            "WithdrawLib",
        ];
        const libs: Record<string, string> = {};
        for (const name of required) {
            const envKey = `LIB_${name
                .replace(/([A-Z])/g, "_$1")
                .toUpperCase()
                .replace(/^_/, "")}`;
            const addr = process.env[envKey]?.trim();
            if (!addr) throw new Error(`Missing env ${envKey} for ${contractName} upgrade`);
            libs[libAddr(name)] = addr;
        }
        return libs;
    }

    if (contractName === "OracleAggregator") {
        const required = ["CircuitBreakerLib", "EmergencyPauseLib", "EmergencyPriceLib"];
        const libs: Record<string, string> = {};
        for (const name of required) {
            const envKey = `LIB_${name
                .replace(/([A-Z])/g, "_$1")
                .toUpperCase()
                .replace(/^_/, "")}`;
            const addr = process.env[envKey]?.trim();
            if (!addr) throw new Error(`Missing env ${envKey} for ${contractName} upgrade`);
            libs[libAddr(name)] = addr;
        }
        return libs;
    }

    if (contractName === "TradingCoreViews") {
        const addr = process.env.LIB_POSITION_MATH?.trim();
        if (!addr) throw new Error("Missing env LIB_POSITION_MATH for TradingCoreViews upgrade");
        return { [libAddr("PositionMath")]: addr };
    }

    return {};
}

async function main() {
    const contractName = requireEnv("CONTRACT_TO_UPGRADE");
    const proxyAddress = requireEnv("PROXY_ADDRESS");

    const libraries = getLibraryLinks(contractName);
    const hasLibs = Object.keys(libraries).length > 0;

    console.log(`Upgrading ${contractName} at proxy ${proxyAddress}`);
    if (hasLibs) {
        console.log(
            "Linked libraries:",
            Object.entries(libraries)
                .map(([k, v]) => `${k.split(":")[1]} -> ${v}`)
                .join(", "),
        );
    }

    const ContractFactory = await ethers.getContractFactory(contractName, hasLibs ? { libraries } : {});
    const upgraded = await upgrades.upgradeProxy(proxyAddress, ContractFactory, {
        ...(hasLibs ? { unsafeAllowLinkedLibraries: true } : {}),
    });
    await upgraded.waitForDeployment();
    const impl = await upgrades.erc1967.getImplementationAddress(await upgraded.getAddress());
    console.log(`${contractName} upgraded. Proxy: ${await upgraded.getAddress()}, Implementation: ${impl}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
