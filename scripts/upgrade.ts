import { ethers, upgrades } from "hardhat";
import { requireEnv } from "./helpers";

/**
 * UUPS upgrade: CONTRACT_TO_UPGRADE, PROXY_ADDRESS.
 * TradingCore also needs LIB_* for each linked library (see .env.example).
 * TradingCoreViews is not upgraded here (non-proxy in deploy.ts); use setTradingViews after redeploy.
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
            "RateLimitLib",
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
