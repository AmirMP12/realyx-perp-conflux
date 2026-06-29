import { ethers, upgrades } from "hardhat";
import { requireEnv } from "./helpers";

/**
 * PHASE 1 of the timelocked UUPS upgrade (see execute-upgrade.ts for phase 2).
 *
 * The core contracts inherit a 48h upgrade timelock
 * (`AccessControlled._enforceUpgradeTimelock`): a new implementation must be
 * STAGED via `proposeImplementation(newImpl)` and can only be activated 48h
 * later. OpenZeppelin's `upgradeProxy` cannot drive this (it calls
 * `upgradeToAndCall` directly and would revert `PendingImplementationMismatch`),
 * so this script:
 *   1. deploys + validates the new implementation via `prepareUpgrade`, and
 *   2. calls `proposeImplementation(newImpl)` on the proxy to start the clock.
 *
 * Env:
 *   CONTRACT_TO_UPGRADE  e.g. OracleAggregator
 *   PROXY_ADDRESS        the proxy to upgrade
 *   LIB_*                only for TradingCore (linked libraries; see upgrade.ts)
 *
 * After 48h, run execute-upgrade.ts with the SAME contract source so the
 * implementation bytecode (and address) matches what was staged here.
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

    console.log(`[propose] Preparing new implementation for ${contractName} (proxy ${proxyAddress})...`);
    const newImpl = (await upgrades.prepareUpgrade(proxyAddress, Factory, {
        ...(hasLibs ? { unsafeAllowLinkedLibraries: true } : {}),
    })) as string;
    console.log(`[propose] New implementation deployed: ${newImpl}`);

    // Stage it on the proxy to start the 48h timelock.
    const proxy = await ethers.getContractAt(contractName, proxyAddress);
    const tx = await proxy.proposeImplementation(newImpl);
    console.log(`[propose] proposeImplementation tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[propose] staged in block ${receipt?.blockNumber} (status=${receipt?.status})`);

    const effective = new Date(Date.now() + 48 * 60 * 60 * 1000);
    console.log("");
    console.log(`✅ Staged. Implementation = ${newImpl}`);
    console.log(`⏳ Executable after ~${effective.toISOString()} (48h).`);
    console.log(`   Then run: CONTRACT_TO_UPGRADE=${contractName} PROXY_ADDRESS=${proxyAddress} \\`);
    console.log(`             npx hardhat run scripts/execute-upgrade.ts --network <network>`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
