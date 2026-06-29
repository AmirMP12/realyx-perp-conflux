import { ethers, upgrades } from "hardhat";
import { requireEnv } from "./helpers";

/**
 * PHASE 2 of the timelocked UUPS upgrade (run AFTER propose-upgrade.ts + 48h).
 *
 * Reuses the implementation deployed in phase 1 (`useDeployedImplementation`)
 * so the address matches the one staged via `proposeImplementation`, then calls
 * the proxy upgrade. The contract's `_authorizeUpgrade` verifies the staged
 * implementation matches and the 48h timelock has elapsed, otherwise reverts
 * (`PendingImplementationMismatch` / `UpgradeTimelockActive`).
 *
 * IMPORTANT: the contract source must be UNCHANGED since phase 1 so the
 * implementation bytecode (hence address) is identical to what was staged.
 *
 * Env:
 *   CONTRACT_TO_UPGRADE  e.g. OracleAggregator
 *   PROXY_ADDRESS        the proxy to upgrade
 *   LIB_*                only for TradingCore (linked libraries; see upgrade.ts)
 */
const libAddr = (name: string) => `contracts/libraries/${name}.sol:${name}`;

function getLibraryLinks(contractName: string): Record<string, string> {
    if (contractName !== "TradingCore") return {};
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

async function main() {
    const contractName = requireEnv("CONTRACT_TO_UPGRADE");
    const proxyAddress = requireEnv("PROXY_ADDRESS");

    const libraries = getLibraryLinks(contractName);
    const hasLibs = Object.keys(libraries).length > 0;

    const Factory = await ethers.getContractFactory(contractName, hasLibs ? { libraries } : {});

    console.log(`[execute] Upgrading ${contractName} at proxy ${proxyAddress} (reusing staged implementation)...`);
    const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory, {
        useDeployedImplementation: true,
        ...(hasLibs ? { unsafeAllowLinkedLibraries: true } : {}),
    });
    await upgraded.waitForDeployment();
    const impl = await upgrades.erc1967.getImplementationAddress(await upgraded.getAddress());
    console.log(`✅ ${contractName} upgraded. Proxy: ${await upgraded.getAddress()}, Implementation: ${impl}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
